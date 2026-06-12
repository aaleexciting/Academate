import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, query, orderBy, onSnapshot, doc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";

const firebaseConfig = { 
    apiKey: "AIzaSyCGr2zchpiAiTn-bMFk-eLNE-1OgGzaSdA", 
    authDomain: "acadmte.firebaseapp.com", 
    projectId: "acadmte",
    storageBucket: "acadmte.appspot.com", 
    messagingSenderId: "547286858993", 
    appId: "1:547286858993:web:b83de49e7eb1cc35a67d50", 
    measurementId: "G-ZEFYD7F650"
};

const app = initializeApp(firebaseConfig);

const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider('6LeCCuQrAAAAAETuv-d3fMG5dtZ4pC_Mz9vPlabc'),
  isTokenAutoRefreshEnabled: true
});

const auth = getAuth(app);
const db = getFirestore(app);

onAuthStateChanged(auth, user => {
    if (user) {
        loadNotifications(user.uid);
    } else {
        window.location.replace('/auth');
    }
});

function loadNotifications(userId) {
    const listEl = document.getElementById('notification-list');
    const q = query(collection(db, 'users', userId, 'notifications'), orderBy('timestamp', 'desc'));

    onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            listEl.innerHTML = `
                <div class="empty-state">
                    <i class="ri-notification-off-line"></i>
                    <h3>Tidak Ada Notifikasi</h3>
                    <p>Anda sudah membaca semuanya!</p>
                </div>`;
            return;
        }

        listEl.innerHTML = '';
        const batch = writeBatch(db);

        snapshot.forEach(docSnap => {
            const notif = docSnap.data();
            const item = document.createElement('li');
            item.className = `notification-item ${!notif.read ? 'unread' : ''}`;

            const iconColor = getIconColor(notif.type);

            item.innerHTML = `
                <div class="noti-icon" style="background-color:${iconColor.bg}; color:${iconColor.text};">
                    <i class="${getIcon(notif.type)}"></i>
                </div>
                <div class="noti-content">
                    <p>${notif.message}</p>
                    <div class="timestamp">
                        <i class="ri-time-line" style="font-size: 12px;"></i> 
                        ${formatTimestamp(notif.timestamp)}
                    </div>
                </div>
            `;
            listEl.appendChild(item);

            if (!notif.read) {
                const notifRef = doc(db, 'users', userId, 'notifications', docSnap.id);
                batch.update(notifRef, { read: true });
            }
        });

        if (!snapshot.empty) {
            batch.commit().catch(err => console.error("Failed to mark notifications as read:", err));
        }

    }, (error) => {
        console.error("Error fetching notifications:", error);
        listEl.innerHTML = `
            <div class="empty-state">
                <i class="ri-error-warning-line" style="color: #EF4444;"></i>
                <h3>Gagal Memuat</h3>
                <p>Silakan periksa koneksi internet Anda.</p>
            </div>`;
    });
}

// --- UPDATED ICON AND COLOR LOGIC ---

function getIcon(type) {
    switch(type) {
        case 'NEW_TASK': 
            return 'ri-file-edit-fill'; // Ikon catatan/tugas
        case 'DEADLINE_REMINDER': 
            return 'ri-alarm-warning-fill'; // Ikon alarm berdering
        case 'CLASS_STARTING': 
            return 'ri-presentation-fill'; // Ikon papan presentasi kelas
        default: 
            return 'ri-notification-4-fill'; // Default bel
    }
}

function getIconColor(type) {
    switch(type) {
        case 'NEW_TASK': 
            return { bg: '#E0E7FF', text: '#4F46E5' }; // Indigo (Info)
        case 'DEADLINE_REMINDER': 
            return { bg: '#FEE2E2', text: '#EF4444' }; // Merah (Urgent)
        case 'CLASS_STARTING': 
            return { bg: '#DCFCE7', text: '#16A34A' }; // Hijau (Action)
        default: 
            return { bg: '#F3F2FF', text: '#6F6CFF' }; // Purple (Default)
    }
}

// ------------------------------------

function formatTimestamp(timestamp) {
    if (!timestamp?.toDate) return '';
    const date = timestamp.toDate();
    const now = new Date();
    const diffSeconds = Math.round((now - date) / 1000);

    if (diffSeconds < 60) return `${diffSeconds} detik yang lalu`;
    const diffMinutes = Math.round(diffSeconds / 60);
    if (diffMinutes < 60) return `${diffMinutes} menit yang lalu`;
    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours} jam yang lalu`;

    return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}