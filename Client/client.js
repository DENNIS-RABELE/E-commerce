import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc
} from "firebase/firestore";
import { customerDb, firebaseReady } from "./firebase.js";
import {
  ICT_CATEGORIES,
  formatMoney,
  matchesProduct,
  mergeCatalogAndInventory,
  sortProducts
} from "../firebase/catalog.js";

const SESSION_KEY = "ict-client-web-session";
const ACCOUNTS_KEY = "ict-client-web-accounts";
const CART_KEY = "ict-client-web-cart";
const ORDERS_KEY = "ict-client-web-orders";

const app = document.getElementById("app");

const state = {
  screen: "login",
  authMode: "login",
  user: null,
  accounts: readJson(ACCOUNTS_KEY, []),
  catalog: [],
  cart: readJson(CART_KEY, []),
  orders: readJson(ORDERS_KEY, []),
  filters: {
    search: "",
    category: "all",
    brand: "all",
    availability: "all",
    condition: "all",
    sort: "newest"
  },
  notice: ""
};

bootstrap();

async function bootstrap() {
  state.user = readJson(SESSION_KEY, null);
  state.screen = state.user ? "products" : "login";
  render();
  if (state.user) await loadFirebaseData();
}

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function cleanText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function validateAccount(account) {
  const namePattern = /^[A-Za-z0-9 ]{1,30}$/;
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!namePattern.test(account.firstName)) return "First name must be 1 to 30 letters or numbers.";
  if (!namePattern.test(account.secondName)) return "Second name must be 1 to 30 letters or numbers.";
  if (!emailPattern.test(account.email)) return "Email address must be valid.";
  if (!/^[A-Za-z0-9]+$/.test(account.password) || account.password.length < 6 || !/\d/.test(account.password)) {
    return "Password must be at least 6 letters/numbers and include 1 number.";
  }
  return "";
}

function accountFromForm(form) {
  const data = new FormData(form);
  return {
    firstName: cleanText(data.get("firstName")),
    secondName: cleanText(data.get("secondName")),
    email: cleanText(data.get("email")).toLowerCase(),
    password: String(data.get("password") || "")
  };
}

async function register(form) {
  const account = accountFromForm(form);
  const validation = validateAccount(account);
  if (validation) return setNotice(validation, true);
  if (state.accounts.some((item) => item.email === account.email)) {
    return setNotice("Registration unsuccessful: email already exists.", true);
  }

  const saved = {
    ...account,
    id: `customer-${account.email.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    createdAt: new Date().toISOString()
  };

  if (firebaseReady) {
    try {
      await addDoc(collection(customerDb, "customerProfiles"), {
        id: saved.id,
        firstName: saved.firstName,
        secondName: saved.secondName,
        name: `${saved.firstName} ${saved.secondName}`,
        email: saved.email,
        accountType: "Retail Customer",
        source: "web-app",
        role: "customer",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error(error);
      state.notice = "Registration saved locally. Firebase profile could not be updated right now.";
    }
  }

  state.accounts = [...state.accounts, saved];
  writeJson(ACCOUNTS_KEY, state.accounts);
  state.authMode = "login";
  setNotice("Registration successful. Please log in.", false);
}

async function login(form) {
  const details = accountFromForm(form);
  const validation = validateAccount(details);
  if (validation) return setNotice(validation, true);

  const user = state.accounts.find((item) =>
    item.firstName.toLowerCase() === details.firstName.toLowerCase()
    && item.secondName.toLowerCase() === details.secondName.toLowerCase()
    && item.email === details.email
    && item.password === details.password
  );

  if (!user) return setNotice("Login unsuccessful: details do not match a registered customer.", true);

  state.user = user;
  state.screen = "products";
  state.notice = "";
  writeJson(SESSION_KEY, user);
  render();
  await loadFirebaseData();
}

function logout() {
  localStorage.removeItem(SESSION_KEY);
  state.user = null;
  state.screen = "login";
  state.notice = "";
  render();
}

function setNotice(message, isError = false) {
  state.notice = { message, isError };
  render();
}

async function readRows(name) {
  const snapshot = await getDocs(collection(customerDb, name));
  return snapshot.docs.map((item) => ({ ...item.data(), docId: item.id, id: item.data().id || item.id }));
}

async function loadFirebaseData() {
  if (!firebaseReady) return;
  try {
    const [products, inventory, cartItems, orders, orderItems] = await Promise.all([
      readRows("catalogProducts"),
      readRows("inventoryItems"),
      readRows("cartItems"),
      readRows("orders"),
      readRows("orderItems")
    ]);

    const catalog = mergeCatalogAndInventory(products, inventory);
    if (catalog.length) state.catalog = catalog;
    if (cartItems.length) state.cart = cartItems.filter((item) => item.customerId === state.user.id);
    if (orders.length) {
      state.orders = orders
        .filter((order) => !order.customerId || order.customerId === state.user.id)
        .map((order) => ({
          ...order,
          items: order.items || orderItems.filter((item) => item.orderId === order.id || item.orderDocId === order.docId)
        }));
    }
    writeJson(CART_KEY, state.cart);
    writeJson(ORDERS_KEY, state.orders);
    render();
  } catch (error) {
    console.error(error);
  }
}

function filteredProducts() {
  return sortProducts(state.catalog.filter((product) => matchesProduct(product, state.filters)), state.filters.sort);
}

function cartTotal() {
  return state.cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 1), 0);
}

async function addToCart(productId) {
  const product = state.catalog.find((item) => String(item.id) === String(productId) || String(item.sku) === String(productId));
  if (!product || product.stock <= 0) return;

  const existing = state.cart.find((item) => item.sku === product.sku);
  if (existing) {
    await updateCartQty(existing.sku, Number(existing.qty || 1) + 1);
    return;
  }

  const item = {
    customerId: state.user.id,
    sku: product.sku,
    productId: product.productId || product.id,
    name: product.name,
    qty: 1,
    price: Number(product.price || 0),
    imageUrl: product.imageUrl || product.photoUrl || ""
  };

  if (firebaseReady) {
    try {
      const ref = await addDoc(collection(customerDb, "cartItems"), {
        ...item,
        createdAt: serverTimestamp()
      });
      item.docId = ref.id;
    } catch (error) {
      console.error(error);
    }
  }

  state.cart = [...state.cart, item];
  writeJson(CART_KEY, state.cart);
  state.screen = "cart";
  render();
}

async function updateCartQty(sku, qty) {
  const nextQty = Math.max(1, Math.round(Number(qty) || 1));
  const item = state.cart.find((entry) => entry.sku === sku);
  state.cart = state.cart.map((entry) => entry.sku === sku ? { ...entry, qty: nextQty } : entry);
  writeJson(CART_KEY, state.cart);
  render();
  if (firebaseReady && item?.docId) {
    try {
      await updateDoc(doc(customerDb, "cartItems", item.docId), {
        qty: nextQty,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error(error);
    }
  }
}

async function removeCartItem(sku) {
  const item = state.cart.find((entry) => entry.sku === sku);
  state.cart = state.cart.filter((entry) => entry.sku !== sku);
  writeJson(CART_KEY, state.cart);
  render();
  if (firebaseReady && item?.docId) {
    try {
      await deleteDoc(doc(customerDb, "cartItems", item.docId));
    } catch (error) {
      console.error(error);
    }
  }
}

async function checkout(form) {
  if (!state.cart.length) return setNotice("Cart is empty.", true);
  const data = new FormData(form);
  const paymentAmount = Number(data.get("paymentAmount") || 0);
  if (paymentAmount !== cartTotal()) {
    return setNotice(`Payment amount must equal ${formatMoney(cartTotal())}.`, true);
  }

  const order = {
    id: `ORD-${Date.now()}`,
    receiptNumber: `INV-${Date.now().toString().slice(-6)}`,
    customerId: state.user.id,
    customer: `${state.user.firstName} ${state.user.secondName}`,
    total: Math.round(cartTotal()),
    amountPaid: Math.round(paymentAmount),
    customerPhone: cleanText(data.get("phone")),
    customerLocation: `${cleanText(data.get("town"))}, ${cleanText(data.get("district"))}`,
    customerAddress: cleanText(data.get("address")),
    paymentMethod: String(data.get("paymentMethod") || "M-Pesa"),
    paymentStatus: "Payment Successful",
    status: "Processing",
    createdAt: new Date().toISOString(),
    items: state.cart.map((item) => ({
      productId: item.productId || item.sku,
      sku: item.sku,
      name: item.name,
      qty: Math.round(Number(item.qty || 1)),
      price: Math.round(Number(item.price || 0))
    }))
  };

  if (firebaseReady) {
    try {
      const orderRef = await addDoc(collection(customerDb, "orders"), {
        ...order,
        createdAt: serverTimestamp()
      });
      await Promise.all(order.items.map((item) => addDoc(collection(customerDb, "orderItems"), {
        orderId: order.id,
        orderDocId: orderRef.id,
        customerId: order.customerId,
        ...item,
        createdAt: serverTimestamp()
      })));
      await addDoc(collection(customerDb, "invoices"), {
        id: order.receiptNumber,
        orderId: order.id,
        customerId: order.customerId,
        amount: order.total,
        paymentMethod: order.paymentMethod,
        customerPhone: order.customerPhone,
        status: "Paid",
        createdAt: serverTimestamp()
      });
      await Promise.allSettled(state.cart.filter((item) => item.docId).map((item) => deleteDoc(doc(customerDb, "cartItems", item.docId))));
    } catch (error) {
      console.error(error);
      return setNotice("Order not completed. Please try again.", true);
    }
  }

  state.orders = [order, ...state.orders];
  state.cart = [];
  state.screen = "orders";
  writeJson(ORDERS_KEY, state.orders);
  writeJson(CART_KEY, state.cart);
  setNotice(`Order placed successfully: ${order.id}`, false);
}

function render() {
  if (!state.user) {
    renderAuth();
    return;
  }

  app.innerHTML = `
    <header class="app-header">
      <div class="brand-row">
        <span class="brand-mark">IC</span>
        <div>
          <p class="eyebrow">Customer web app</p>
          <h1>${state.screen === "products" ? "Products" : state.screen === "cart" ? "Cart" : "Orders"}</h1>
        </div>
      </div>
      <button class="ghost-button" data-action="logout">Log out</button>
    </header>
    <section class="app-layout">
      <nav class="sidebar" aria-label="Customer sections">
        ${navButton("products", "Products")}
        ${navButton("cart", `Cart (${state.cart.length})`)}
        ${navButton("orders", "Orders")}
      </nav>
      <section class="main-content">
        ${noticeHtml()}
        ${state.screen === "products" ? productsHtml() : ""}
        ${state.screen === "cart" ? cartHtml() : ""}
        ${state.screen === "orders" ? ordersHtml() : ""}
      </section>
    </section>
  `;
  bindAppEvents();
}

function renderAuth() {
  const isRegister = state.authMode === "register";
  app.innerHTML = `
    <section class="auth-layout">
      <form id="authForm" class="auth-panel">
        <div class="brand-row">
          <span class="brand-mark">IC</span>
          <div>
            <p class="eyebrow">Customer web app</p>
            <h1>${isRegister ? "Create account" : "Customer login"}</h1>
          </div>
        </div>
        ${noticeHtml()}
        <div class="form-grid">
          <label>First name <input name="firstName" autocomplete="given-name" required /></label>
          <label>Second name <input name="secondName" autocomplete="family-name" required /></label>
          <label>Email <input name="email" type="email" autocomplete="email" required /></label>
          <label>Password <input name="password" type="password" autocomplete="${isRegister ? "new-password" : "current-password"}" required /></label>
        </div>
        <div class="button-row">
          <button class="primary-button" type="submit">${isRegister ? "Register" : "Log in"}</button>
          <button class="ghost-button" type="button" data-action="toggle-auth">${isRegister ? "Already have account" : "Create account"}</button>
        </div>
      </form>
      <aside class="auth-visual">
        <img src="./assets/customer-suite.svg" alt="ICT customer web app preview" />
      </aside>
    </section>
  `;

  document.getElementById("authForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (isRegister) register(event.currentTarget);
    else login(event.currentTarget);
  });
  app.querySelector("[data-action='toggle-auth']").addEventListener("click", () => {
    state.authMode = isRegister ? "login" : "register";
    state.notice = "";
    render();
  });
}

function noticeHtml() {
  if (!state.notice?.message) return "";
  return `<div class="notice ${state.notice.isError ? "error" : ""}">${escapeHtml(state.notice.message)}</div>`;
}

function navButton(screen, label) {
  return `<button class="nav-button ${state.screen === screen ? "active" : ""}" data-screen="${screen}">${escapeHtml(label)}</button>`;
}

function productsHtml() {
  const brands = [...new Set(state.catalog.map((product) => product.brand).filter(Boolean))].sort();
  const products = filteredProducts();
  return `
    <div class="toolbar">
      <input data-filter="search" placeholder="Search products" value="${escapeHtml(state.filters.search)}" />
      ${selectHtml("category", ["all", ...ICT_CATEGORIES])}
      ${selectHtml("brand", ["all", ...brands])}
      ${selectHtml("sort", ["newest", "lowest", "highest", "popularity"])}
    </div>
    <div class="product-grid">
      ${products.map(productCard).join("") || `<div class="card">No products match the current filters.</div>`}
    </div>
  `;
}

function selectHtml(name, options) {
  return `
    <select data-filter="${name}">
      ${options.map((option) => `<option value="${escapeHtml(option)}" ${state.filters[name] === option ? "selected" : ""}>${escapeHtml(option === "all" ? `All ${name}s` : option)}</option>`).join("")}
    </select>
  `;
}

function productCard(product) {
  const image = product.imageUrl || product.photoUrl;
  return `
    <article class="card">
      ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" />` : ""}
      <h3>${escapeHtml(product.name)}</h3>
      <p class="meta">${escapeHtml(product.brand || "ICT")} | ${escapeHtml(product.category || "Product")} | ${escapeHtml(product.condition || "New")}</p>
      <p>${escapeHtml(product.description || "ICT product")}</p>
      <p class="price">${formatMoney(product.price)}</p>
      <p class="meta">${product.stock > 0 ? `Available: ${Math.round(product.stock)}` : "Out of stock"}</p>
      <button class="primary-button" data-add-cart="${escapeHtml(product.id)}" ${product.stock <= 0 ? "disabled" : ""}>Add to cart</button>
    </article>
  `;
}

function cartHtml() {
  return `
    <section class="split">
      <div class="content-panel">
        <h2>Cart</h2>
        ${state.cart.map(cartItemHtml).join("") || `<p class="meta">Cart is empty. Add products from the catalog.</p>`}
        <h3>Total: ${formatMoney(cartTotal())}</h3>
      </div>
      <form id="checkoutForm" class="content-panel">
        <h2>Checkout</h2>
        <div class="form-grid">
          <label>Phone <input name="phone" inputmode="numeric" required /></label>
          <label>District <input name="district" value="Maseru" required /></label>
          <label>Town <input name="town" required /></label>
          <label>Address <textarea name="address" required></textarea></label>
          <label>Payment method
            <select name="paymentMethod">
              <option>M-Pesa</option>
              <option>EcoCash</option>
              <option>Bank Card</option>
            </select>
          </label>
          <label>Payment amount <input name="paymentAmount" type="number" min="0" step="0.01" value="${cartTotal()}" required /></label>
        </div>
        <button class="primary-button" type="submit" ${state.cart.length ? "" : "disabled"}>Place order</button>
      </form>
    </section>
  `;
}

function cartItemHtml(item) {
  return `
    <article class="line-item">
      <strong>${escapeHtml(item.name)}</strong>
      <span class="meta">${escapeHtml(item.sku)} | ${formatMoney(Number(item.price || 0) * Number(item.qty || 1))}</span>
      <div class="qty-row">
        <button class="qty-button" data-qty="${escapeHtml(item.sku)}" data-next="${Number(item.qty || 1) - 1}" type="button">-</button>
        <span>${Math.round(Number(item.qty || 1))}</span>
        <button class="qty-button" data-qty="${escapeHtml(item.sku)}" data-next="${Number(item.qty || 1) + 1}" type="button">+</button>
        <button class="danger-button" data-remove="${escapeHtml(item.sku)}" type="button">Remove</button>
      </div>
    </article>
  `;
}

function ordersHtml() {
  return `
    <div class="content-panel">
      <h2>Recent orders</h2>
      ${state.orders.map((order) => `
        <article class="order-item">
          <strong>${escapeHtml(order.id)} | ${formatMoney(order.total)}</strong>
          <span class="meta">${escapeHtml(order.paymentStatus || "Payment Successful")} | ${escapeHtml(order.status || "Processing")}</span>
          <span class="meta">Receipt ${escapeHtml(order.receiptNumber || "generated")}</span>
          <span class="meta">${escapeHtml(order.customerLocation || "Location not specified")}</span>
        </article>
      `).join("") || `<p class="meta">No orders yet.</p>`}
    </div>
  `;
}

function bindAppEvents() {
  app.querySelector("[data-action='logout']")?.addEventListener("click", logout);
  app.querySelectorAll("[data-screen]").forEach((button) => {
    button.addEventListener("click", () => {
      state.screen = button.dataset.screen;
      state.notice = "";
      render();
    });
  });
  app.querySelectorAll("[data-filter]").forEach((field) => {
    field.addEventListener("input", () => {
      state.filters[field.dataset.filter] = field.value;
      render();
    });
  });
  app.querySelectorAll("[data-add-cart]").forEach((button) => {
    button.addEventListener("click", () => addToCart(button.dataset.addCart));
  });
  app.querySelectorAll("[data-qty]").forEach((button) => {
    button.addEventListener("click", () => updateCartQty(button.dataset.qty, button.dataset.next));
  });
  app.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => removeCartItem(button.dataset.remove));
  });
  app.querySelector("#checkoutForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    checkout(event.currentTarget);
  });
}
