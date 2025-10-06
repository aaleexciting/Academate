import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, query, orderBy, onSnapshot, doc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Your Firebase project configuration
const firebaseConfig = { apiKey: "AIzaSyCGr2zchpiAiTn-bMFk-eLNE-1OgGzaSdA", authDomain: "acadmte.firebaseapp.com", projectId: "acadmte" };

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Listen for authentication state changes
onAuthStateChanged(auth, user => {
    if (user) {
        // If the user is logged in, load their notifications
        loadNotifications(user.uid);
    } else {
        // If not logged in, redirect to the login page
        window.location.replace('auth.html');
    }
});

/**
 * Fetches and displays notifications for a given user ID.
 * @param {string} userId The ID of the logged-in user.
 */
function loadNotifications(userId) {
    const listEl = document.getElementById('notification-list');
    // Create a query to get notifications, ordered by the newest first
    const q = query(collection(db, 'users', userId, 'notifications'), orderBy('timestamp', 'desc'));

    // onSnapshot listens for real-time updates to the query
    onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            listEl.innerHTML = `<div class="empty-state">Anda belum memiliki notifikasi.</div>`;
            return;
        }

        listEl.innerHTML = ''; // Clear the list before adding new items
        const batch = writeBatch(db); // Use a batch to perform multiple writes at once

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
                    <div class="timestamp">${formatTimestamp(notif.timestamp)}</div>
                </div>
            `;
            listEl.appendChild(item);

            // If a notification is unread, add an update operation to our batch to mark it as read
            if (!notif.read) {
                const notifRef = doc(db, 'users', userId, 'notifications', docSnap.id);
                batch.update(notifRef, { read: true });
            }
        });

        // Commit all the "mark as read" updates to Firestore
        batch.commit().catch(err => console.error("Failed to mark notifications as read:", err));

    }, (error) => {
        console.error("Error fetching notifications:", error);
        listEl.innerHTML = `<div class="empty-state">Gagal memuat notifikasi. Silakan coba lagi.</div>`;
    });
}

// Helper function to determine the correct icon based on notification type
function getIcon(type) {
    switch(type) {
        case 'NEW_TASK': return 'ri-task-line';
        case 'DEADLINE_REMINDER': return 'ri-time-line';
        case 'CLASS_STARTING': return 'ri-vidicon-line';
        default: return 'ri-notification-3-line';
    }
}

// Helper function to style the icon based on notification type
function getIconColor(type) {
    switch(type) {
        case 'NEW_TASK': return { bg: '#E0F2FE', text: '#0EA5E9' }; // Blue
        case 'DEADLINE_REMINDER': return { bg: '#FEF3C7', text: '#F59E0B' }; // Yellow
        case 'CLASS_STARTING': return { bg: '#ECFDF5', text: '#10B981' }; // Green
        default: return { bg: '#F3F2FF', text: '#6F6CFF' }; // Primary Purple
    }
}

// Helper function to format the timestamp into a readable string (e.g., "5 menit yang lalu")
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