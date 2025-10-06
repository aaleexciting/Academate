importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

const firebaseConfig = {
    apiKey: "AIzaSyCGr2zchpiAiTn-bMFk-eLNE-1OgGzaSdA",
    authDomain: "acadmte.firebaseapp.com",
    projectId: "acadmte",
    storageBucket: "acadmte.appspot.com",
    messagingSenderId: "547286858993",
    appId: "1:547286858993:web:b83de49e7eb1cc35a67d50"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();
