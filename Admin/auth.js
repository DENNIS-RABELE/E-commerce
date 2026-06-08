import { doc, getDocs, collection, serverTimestamp, setDoc } from "firebase/firestore";
import { adminDb, firebaseReady } from "./firebase.js";

const MAX_ADMINS = 5;
const ACCOUNTS_KEY = "ict-admin-accounts";
const SESSION_KEY = "ict-admin-session";

// Defer DOM access until DOM is ready
let registerForm;
let loginForm;
let notice;
let showLoginBtn;
let showRegisterBtn;

function initializeForms() {
  registerForm = document.getElementById("adminRegisterForm");
  loginForm = document.getElementById("adminLoginForm");
  notice = document.getElementById("authNotice");
  showLoginBtn = document.getElementById("showLoginBtn");
  showRegisterBtn = document.getElementById("showRegisterBtn");
  
  // Now attach event listeners after forms are initialized
  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const accounts = readAccounts();
    const details = normalize(registerForm);
    const validation = validateAdmin(details);

    if (validation) {
      notify("error", `Registration unsuccessful: ${validation}`);
      return;
    }

    if (accounts.length >= MAX_ADMINS) {
      notify("error", "Registration unsuccessful: the system only allows up to 5 admins.");
      return;
    }

    const admin = {
      id: `admin-${Date.now()}`,
      firstName: details.firstName,
      secondName: details.secondName,
      email: details.email,
      password: details.password,
      createdAt: new Date().toISOString()
    };

    accounts.push(admin);
    writeAccounts(accounts);

    if (firebaseReady) {
      try {
        await setDoc(
          doc(adminDb, "adminUsers", admin.id),
          {
            id: admin.id,
            firstName: admin.firstName,
            secondName: admin.secondName,
            email: admin.email,
            role: "admin",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          }
        );
      } catch (error) {
        console.error(error);
        notify("success", "Registration successful locally. Firebase adminUsers could not be updated right now.");
        showPanel("login");
        return;
      }
    }
    registerForm.reset();
    notify("success", "Registration successful: admin account created and saved to Firebase.");
    showPanel("login");
  });

  loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const details = normalize(loginForm);
    const validation = validateAdmin(details);

    if (validation) {
      notify("error", `Login unsuccessful: ${validation}`);
      loginForm.reset();
      return;
    }

    const admin = readAccounts().find((account) =>
      account.firstName.toLowerCase() === details.firstName.toLowerCase()
      && account.secondName.toLowerCase() === details.secondName.toLowerCase()
      && account.email === details.email
      && account.password === details.password
    );

    if (!admin) {
      notify("error", "Login unsuccessful: First Name, Second Name, Email address, and Password must match a registered admin.");
      loginForm.reset();
      return;
    }

    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      id: admin.id,
      firstName: admin.firstName,
      secondName: admin.secondName,
      email: admin.email,
      loggedInAt: new Date().toISOString()
    }));
    window.location.href = "dashboard.html";
  });

  showLoginBtn.addEventListener("click", () => showPanel("login"));
  showRegisterBtn.addEventListener("click", () => showPanel("register"));

  syncFirebaseAdmins().finally(() => showPanel(readAccounts().length ? "login" : "register"));
}

function readAccounts() {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeAccounts(accounts) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

function notify(type, message) {
  notice.hidden = false;
  notice.className = `auth-notice ${type}`;
  notice.textContent = message;
}

function showPanel(panel) {
  const isLogin = panel === "login";
  registerForm.reset();
  loginForm.reset();
  loginForm.hidden = !isLogin;
  registerForm.hidden = isLogin;
}

function normalize(form) {
  const data = new FormData(form);
  return {
    firstName: String(data.get("firstName") || "").trim(),
    secondName: String(data.get("secondName") || "").trim(),
    email: String(data.get("email") || "").trim().toLowerCase(),
    password: String(data.get("password") || "")
  };
}

function validateAdmin(details) {
  const namePattern = /^[a-z0-9 -]{1,30}$/i;
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
  const passwordAllowed = /^[A-Za-z0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]+$/;

  if (!details.firstName || !details.secondName || !details.email || !details.password) {
    return "All four attributes are required.";
  }

  if (!namePattern.test(details.firstName)) {
    return "First Name must be alphanumerical and not longer than 20 characters.";
  }

  if (!namePattern.test(details.secondName)) {
    return "Second Name must be alphanumerical and not longer than 20 characters.";
  }

  if (!emailPattern.test(details.email)) {
    return "Email address must be valid.";
  }

  if (details.password.length < 6) {
    return "Password must be at least 6 characters.";
  }

  if (!passwordAllowed.test(details.password) || !/[A-Za-z]/.test(details.password)) {
    return "Password must use letters, numbers, and allowed special characters.";
  }

  if (!/\d/.test(details.password)) {
    return "Password must contain at least 1 number.";
  }

  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(details.password)) {
    return "Password must contain at least 1 special character.";
  }

  return "";
}

async function recordAdminUser(details) {
  if (!firebaseReady) return true;
  const id = details.id || `admin-${Date.now()}`;
  await setDoc(doc(adminDb, "adminUsers", id), {
    id,
    firstName: details.firstName,
    secondName: details.secondName,
    name: `${details.firstName} ${details.secondName}`,
    email: details.email,
    password: details.password,
    role: "Admin",
    roleId: "role-admin",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });
  return true;
}

async function syncFirebaseAdmins() {
  if (!firebaseReady) return;
  try {
    const snapshot = await getDocs(collection(adminDb, "adminUsers"));
    const firebaseAccounts = snapshot.docs
      .map((item) => ({ ...item.data(), id: item.data().id || item.id }))
      .filter((item) => item.firstName && item.secondName && item.email && item.password);
    if (!firebaseAccounts.length) return;
    const local = readAccounts();
    const merged = [...local];
    firebaseAccounts.forEach((account) => {
      if (!merged.some((item) => item.email === account.email)) merged.push(account);
    });
    writeAccounts(merged.slice(0, MAX_ADMINS));
  } catch (error) {
    console.error(error);
  }
}

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const accounts = readAccounts();
  const details = normalize(registerForm);
  const validation = validateAdmin(details);

  if (validation) {
    notify("error", `Registration unsuccessful: ${validation}`);
    return;
  }

  if (accounts.length >= MAX_ADMINS) {
    notify("error", "Registration unsuccessful: the system only allows up to 5 admins.");
    return;
  }

  if (accounts.some((account) => account.email === details.email)) {
    notify("error", "Registration unsuccessful: an admin with this Gmail address already exists.");
    return;
  }

  const account = {
    ...details,
    id: `admin-${Date.now()}`,
    createdAt: new Date().toISOString()
  };

  accounts.push(account);
  writeAccounts(accounts);
  try {
    await recordAdminUser(account);
  } catch (error) {
    console.error(error);
    notify("success", "Registration successful locally. Firebase adminUsers could not be updated right now.");
    showPanel("login");
    return;
  }
  registerForm.reset();
  notify("success", "Registration successful: admin account created and saved to Firebase.");
  showPanel("login");
});

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const details = normalize(loginForm);
  const validation = validateAdmin(details);

  if (validation) {
    notify("error", `Login unsuccessful: ${validation}`);
    loginForm.reset();
    return;
  }

  const admin = readAccounts().find((account) =>
    account.firstName.toLowerCase() === details.firstName.toLowerCase()
    && account.secondName.toLowerCase() === details.secondName.toLowerCase()
    && account.email === details.email
    && account.password === details.password
  );

  if (!admin) {
    notify("error", "Login unsuccessful: First Name, Second Name, Email address, and Password must match a registered admin.");
    loginForm.reset();
    return;
  }

  sessionStorage.setItem(SESSION_KEY, JSON.stringify({
    id: admin.id,
    firstName: admin.firstName,
    secondName: admin.secondName,
    email: admin.email,
    loggedInAt: new Date().toISOString()
  }));
  window.location.href = "dashboard.html";
});

showLoginBtn.addEventListener("click", () => showPanel("login"));
showRegisterBtn.addEventListener("click", () => showPanel("register"));

syncFirebaseAdmins().finally(() => showPanel(readAccounts().length ? "login" : "register"));
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeForms);
} else {
  initializeForms();
}
