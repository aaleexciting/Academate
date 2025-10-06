const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

// --- HELPER FUNCTION ---
async function sendNotificationToUser(userId, payload, notificationData) {
    // --- Step 1: Create the In-App Notification (Guaranteed to run) ---
    try {
        await db.collection("users").doc(userId).collection("notifications").add(notificationData);
        console.log(`Successfully created in-app notification for ${userId}.`);
    } catch (error) {
        console.error(`Failed to create in-app notification for ${userId}`, error);
        return;
    }

    // --- Step 2: Attempt to Send the Push Notification (Runs separately) ---
    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists) {
        console.log(`User ${userId} not found, skipping push notification.`);
        return;
    }
    const tokens = userDoc.data().fcmTokens || [];

    if (tokens.length > 0) {
        try {
            await admin.messaging().sendToDevice(tokens, payload);
            console.log(`Successfully sent push notification to ${userId}.`);
        } catch (error) {
            console.error(`ERROR sending push notification to ${userId}:`, error.message);
        }
    } else {
        console.log(`No FCM tokens found for user ${userId}. Skipping push notification.`);
    }
}


// --- NOTIFICATION TRIGGERS ---

// TRIGGER: When a new task is created
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
            message: `${task.creatorName || 'Seseorang'} menambahkan tugas baru "${task.title || 'Tanpa Judul'}" di kelas ${classData.namaMataKuliah || 'Kelas'}.`,
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

// ... (The rest of your functions: taskDeadlineReminder, classStartingReminder, onMemberKicked remain exactly the same)
// --- TRIGGER: Scheduled every hour for deadline reminders ---
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
                message: `Jangan lupa, tugas "${task.title || 'Tanpa Judul'}" untuk kelas ${classData.namaMataKuliah || 'Kelas'} akan berakhir dalam 24 jam.`,
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

// --- TRIGGER: Scheduled every 10 minutes for class reminders ---
exports.classStartingReminder = functions.region("asia-southeast2").pubsub
    .schedule("every 10 minutes")
    .onRun(async (context) => {
        const now = new Date();
        const tenMinutesFromNow = new Date(now.getTime() + 10 * 60 * 1000);
        const dayName = now.toLocaleDateString('id-ID', { weekday: 'long' });

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
                    message: `Kelas ${classData.namaMataKuliah || 'Kelas'} akan dimulai dalam 10 menit di Ruang ${classData.ruang || '?'}.`,
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
// --- TRIGGER: When a class document is updated (your original function) ---
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