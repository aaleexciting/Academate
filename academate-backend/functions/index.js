const functions = require("firebase-functions");
const admin = require("firebase-admin");
const jwt = require("jsonwebtoken"); // Added for Jitsi token generation

admin.initializeApp();
const db = admin.firestore();

// --- TELEGRAM HELPER ---
async function sendTelegramNotification(telegramChatId, message) {
    if (!telegramChatId) return;

    const token = functions.config().telegram.token;
    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: telegramChatId,
                text: message,
                parse_mode: 'HTML'
            })
        });
    } catch (error) {
        console.error("Telegram Error:", error);
    }
}

// --- FCM/IN-APP HELPER ---
async function sendNotificationToUser(userId, payload, notificationData) {
    // 1. Save in-app notification
    try {
        await db.collection("users").doc(userId).collection("notifications").add(notificationData);
    } catch (error) {
        console.error(`Failed to create in-app notification for ${userId}`, error);
    }

    // 2. Fetch User to get tokens and Telegram ID
    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists) return;
    const userData = userDoc.data();

    // 3. Send Push Notification (FCM)
    const tokens = userData.fcmTokens || [];
    if (tokens.length > 0) {
        try {
            await admin.messaging().sendToDevice(tokens, payload);
        } catch (error) {
            console.error(`ERROR sending push to ${userId}:`, error.message);
        }
    }

    // 4. Send Telegram Notification
    if (userData.telegramChatId) {
        await sendTelegramNotification(userData.telegramChatId, notificationData.message);
    }
}

// --- WEBHOOK FOR TELEGRAM CONNECTION ---
exports.telegramWebhook = functions.region("asia-southeast2").https.onRequest(async (req, res) => {
    const update = req.body;
    if (update.message && update.message.text && update.message.text.startsWith('/start')) {
        const parts = update.message.text.split(' ');
        const firebaseUid = parts[1]; // The user's ID passed from your button
        
        if (firebaseUid) {
            const chatId = update.message.chat.id;
            await db.collection("users").doc(firebaseUid).update({ telegramChatId: chatId });
            
            const token = functions.config().telegram.token;
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    chat_id: chatId, 
                    text: "✅ Academate berhasil dihubungkan! Anda sekarang akan menerima notifikasi di sini." 
                })
            });
        }
    }
    res.status(200).send("OK");
});

// --- TRIGGERS ---

exports.onNewTask = functions.region("asia-southeast2").firestore
    .document("classes/{classId}/tasks/{taskId}")
    .onCreate(async (snap, context) => {
        const task = snap.data();
        const { classId } = context.params;

        const classDoc = await db.collection("classes").doc(classId).get();
        if (!classDoc.exists) return;
        
        const classData = classDoc.data();
        const members = classData.members || [];
        const taskCreatorId = task.creatorId || null;

        const payload = {
            notification: {
                title: `Tugas Baru: ${classData.namaMataKuliah || 'Kelas'}`,
                body: `${task.creatorName || 'Seseorang'} menambahkan: ${task.title || 'Tanpa Judul'}`,
                icon: "https://acadmte.web.app/icon/favicon-96x96.png",
            }
        };

        const notificationData = {
            message: `🔔 <b>Tugas Baru: ${task.title || 'Tanpa Judul'}</b>\n` +
                     `━━━━━━━━━━━━━━━━━━━━\n` +
                     `📚 <b>Kelas:</b> ${classData.namaMataKuliah || 'Kelas'}\n` +
                     `👤 <b>Oleh:</b> ${task.creatorName || 'Seseorang'}\n` +
                     `📅 <b>Tenggat:</b> ${task.dueDate ? new Date(task.dueDate.seconds * 1000).toLocaleDateString('id-ID') : 'Tidak ditentukan'}\n` +
                     `📝 <b>Detail:</b> ${task.description || 'Tidak ada detail tambahan.'}`,
            type: 'NEW_TASK',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            read: false,
        };

        const promises = members.map(memberId => {
            if (memberId === taskCreatorId) return null;
            return sendNotificationToUser(memberId, payload, notificationData);
        });

        return Promise.all(promises);
    });

exports.taskDeadlineReminder = functions.region("asia-southeast2").pubsub
    .schedule("every 1 hours")
    .onRun(async (context) => {
        const now = new Date();
        const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

        const tasksSnapshot = await db.collectionGroup("tasks").where("dueDate", ">=", now).where("dueDate", "<=", twentyFourHoursFromNow).get();
        if (tasksSnapshot.empty) return;

        const promises = tasksSnapshot.docs.map(async (doc) => {
            const task = doc.data();
            const classRef = doc.ref.parent.parent;
            if (!classRef) return;

            const classDoc = await classRef.get();
            if (!classDoc.exists) return;

            const classData = classDoc.data();
            const members = classData.members || [];
            
            const payload = {
                notification: {
                    title: `Tenggat Mendatang: ${classData.namaMataKuliah || 'Kelas'}`,
                    body: `Tugas "${task.title || 'Tanpa Judul'}" akan berakhir dalam 24 jam!`,
                    icon: "https://acadmte.web.app/icon/favicon-96x96.png",
                }
            };

            const notificationData = {
                message: `⚠️ <b>Tenggat Mendatang!</b>\n` +
                         `━━━━━━━━━━━━━━━━━━━━\n` +
                         `📌 <b>Tugas:</b> ${task.title || 'Tanpa Judul'}\n` +
                         `📚 <b>Kelas:</b> ${classData.namaMataKuliah || 'Kelas'}\n` +
                         `⏳ <b>Berakhir:</b> ${task.dueDate ? new Date(task.dueDate.seconds * 1000).toLocaleString('id-ID') : 'Segera'}\n` +
                         `<i>Jangan sampai terlewat ya!</i>`,
                type: 'DEADLINE_REMINDER',
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                read: false,
            };

            const memberPromises = members.map(memberId => {
                if (!task.completedBy || !task.completedBy.includes(memberId)) {
                    return sendNotificationToUser(memberId, payload, notificationData);
                }
                return null;
            });
            return Promise.all(memberPromises);
        });

        return Promise.all(promises);
    });

exports.classStartingReminder = functions.region("asia-southeast2").pubsub
    .schedule("every 10 minutes")
    .onRun(async (context) => {
        const nowWIBString = new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
        const now = new Date(nowWIBString);
        const tenMinutesFromNow = new Date(now.getTime() + 10 * 60 * 1000);
        const dayName = new Intl.DateTimeFormat('id-ID', { weekday: 'long', timeZone: 'Asia/Jakarta' }).format(now);

        const classesSnapshot = await db.collection("classes").where("hari", "==", dayName).get();
        if (classesSnapshot.empty) return;

        const promises = [];
        classesSnapshot.forEach(doc => {
            const classData = doc.data();
            if (!classData.waktu) return;
            const [startHour, startMinute] = classData.waktu.split(':').map(Number);
            
            const startTime = new Date(now);
            startTime.setHours(startHour, startMinute, 0, 0);

            if (startTime >= now && startTime <= tenMinutesFromNow) {
                const payload = {
                    notification: {
                        title: `Kelas Akan Dimulai: ${classData.namaMataKuliah || 'Kelas'}`,
                        body: `Kelas di Ruang ${classData.ruang || '?'} akan dimulai dalam 10 menit.`,
                        icon: "https://acadmte.web.app/icon/favicon-96x96.png",
                    }
                };

                const notificationData = {
                    message: `🕒 <b>Kelas Segera Dimulai!</b>\n` +
                             `━━━━━━━━━━━━━━━━━━━━\n` +
                             `📚 <b>Matkul:</b> ${classData.namaMataKuliah || 'Kelas'}\n` +
                             `🏫 <b>Ruangan:</b> ${classData.ruang || '?'}\n` +
                             `⏰ <b>Waktu:</b> ${classData.waktu || 'TBA'}\n` +
                             `<i>Segera menuju ke kelas!</i>`,
                    type: 'CLASS_STARTING',
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    read: false,
                };

                (classData.members || []).forEach(memberId => {
                    promises.push(sendNotificationToUser(memberId, payload, notificationData));
                });
            }
        });
        return Promise.all(promises);
    });

exports.onMemberKicked = functions.region("asia-southeast2").firestore
    .document("classes/{classId}")
    .onUpdate(async (change, context) => {
      const dataBefore = change.before.data();
      const dataAfter = change.after.data();
      const membersBefore = dataBefore.members || [];
      const membersAfter = dataAfter.members || [];
      if (membersBefore.length <= membersAfter.length) return null;
      
      const kickedMemberIds = membersBefore.filter(id => !membersAfter.includes(id));
      if (kickedMemberIds.length === 0) return null;
      
      const promises = kickedMemberIds.map(userId => {
        return db.collection("users").doc(userId).update({
          joinedClasses: admin.firestore.FieldValue.arrayRemove(context.params.classId),
        });
      });

      return Promise.all(promises);
    });

exports.onClassDeleted = functions.region("asia-southeast2").firestore
    .document("classes/{classId}")
    .onDelete(async (snap, context) => {
        const deletedClass = snap.data();
        const classId = context.params.classId;
        const members = deletedClass.members || [];
        if (members.length === 0) return null;
        const batch = db.batch();
        members.forEach(userId => {
            const userRef = db.collection("users").doc(userId);
            batch.update(userRef, {
                joinedClasses: admin.firestore.FieldValue.arrayRemove(classId)
            });
        });
        return batch.commit();
    });


// --- JITSI TOKEN GENERATOR ---
exports.generateJitsiToken = functions.region("asia-southeast2").https.onCall((data, context) => {
    // 1. Verify user is logged in
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Anda harus login untuk membuat sesi rapat.");
    }

    // 2. Your 8x8 JaaS Credentials (Hardcoded for direct deployment)
    const APP_ID = "vpaas-magic-cookie-889e861450a1472c803508843052351f";
    const KEY_ID = "f53cee";
    const PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCg76zMBqbQUoTu
IB8WjdORudzX2bw063LxWczJFTFk+TguzVEet8PHtjRAaXDt9fpybYwY6U4yMZvd
/HWcEBomPxtXXleQNcZzheSsSIWqw5qWD3dfjVAS6TmzFhGzjlrWyGCgv7zu8MVY
I/YtLLyup2ZAfs3aki79iIadclj8Kw5sIpRWiP0edNS84reOcL1i8eKirqEeWXkW
jfNU90mq/ydMRNnzZUid8ZGRKTbRWhgHWP77WglcHU3Ibl3YmMvf6YRROVvwNGDx
qKg+ZHJ/+B+QNIC2Uv8tjpm4RGdap0/3+K0GlzaE+0wNf5moGdwC/NR7OsqVs4Wt
exPGLUS7AgMBAAECggEAfuLZE3d/GCqngfOzbx3dHD01QL375KFqW53YlwXtjtXr
lQLuHVD3vEMMyWgY0JUqpAN4/L8dlveEE66Tr7sGUvdYgDbyxNGRKM39MFRxhuR3
wi5piN2qr25QvsD8rdvkBQmxHaxustkETuzzkESAcxeqx9jyRo0RHXYB5KseO5oY
ZuiYSqY91irckzutGrxEA7sFIWuCl6u1BBypvCmWQJDvEfx2bpVO8IhZHO6qcLjM
esob2zathow7pXt/OHJv+HbNws6+aZ/NkfzYErp+8BdPrWMZCDPZy59mc8WHFtje
VxvBbJeVwJj+8G0+NXSy9Sc+3v/p4PhJQLrZRpICcQKBgQDld/s/IvjhzxokBKA3
zCJLW+IsBKesq1VwvRBrfeB4ovfpooTWZLczo3d3fqoHf9L5QnOv1iHCU6UL0Ybd
4PTgMc/FUsJz/vWg6tvReUfNbRlC4JlXiNWCSS5rudqnHUg1JWTxygmutBq1K0Al
eH4wT+iMv0JgpVoj0KBTAW03CQKBgQCzizWFc4qsmfMVrjdFSjHLlCxPm5JRWo3l
XMHExoekPNdtcuq0PyhotX6+8vkRFvDJgWslDlPnlcLdiOaJBPRdEALQ3dUHcNXW
17xstTIKJ+knTleLtviXJe/F+Y7PisZQe+nwz9uTaxR7+++GpIcpjC0TtObG1HW6
+lPu5u3qowKBgGz+bXeSy/at4XPEQrneG1gCH87asy4f/6haFWeJVcrXVbxCtqgD
FMXRWliG8Io5W+OLfdnCcyyTgGy5rD7NsGKhJlhKtBRWwSMbCyhXXBSmQn5yokNi
uk91JTiEAeiozvh3d5glaC30XE87aO+jaQTXn9Tir8uqHsOuP8jNf6vJAoGAXhoP
YjONsis6IdnetB1P/gBaPRsv1B3fEyDLmkPnoegVjRLW+sPDfSXrGU+lxRQ9/Y8s
Rg69YTq4GH6BPb1wCjqzDx/FYJH+Mg1+f4d0g6gpZmWEMwEiR64lfqDu/c4hZNud
YI7A6gIMiXMhNnOTN+51TcfZ0MpYLji3txYoCnsCgYBwnJ1diCLMMOBcq8deV7h+
78gMjOU5s/6uc+0H7GYGSCBiXM7q+4ZE5jISXXdRWtekHK3x/l3KBXQr5KYiFZUZ
TAS5d/efC5b7lyLKQC1jF8B1FNipwDT0dgqRjSlQd3cxR5XY5xhskitMfCAByshz
d9thVHhsmsVFizEO1dV+iA==
-----END PRIVATE KEY-----`;

    // 3. Get user data from context
    const user = context.auth.token;

    // 4. Construct the Jitsi Payload
    const payload = {
        aud: "jitsi",
        iss: "chat",
        sub: APP_ID,
        room: "*", // Allows this token to be used for any room name
        context: {
            user: {
                name: user.name || "Anggota Kelas",
                email: user.email || "",
                avatar: user.picture || "",
                moderator: true // IMPORTANT: Makes everyone a moderator so the room opens instantly without waiting
            },
            features: {
                livestreaming: false,
                recording: false,
                "outbound-call": false
            }
        }
    };

    // 5. Sign the token (Valid for 2 hours)
    const options = {
        expiresIn: "2h",
        algorithm: "RS256",
        keyid: `${APP_ID}/${KEY_ID}`
    };

    const token = jwt.sign(payload, PRIVATE_KEY, options);
    return { token: token };
});
