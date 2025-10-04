const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

/**
 * A Cloud Function that triggers when a class document is updated.
 * It checks if any members were removed and cleans up their user profiles.
 */
// **FIX:** Explicitly set the deployment region to match your Firestore database.
// Replace "asia-southeast2" with your actual Firestore region if it's different.
exports.onMemberKicked = functions.region("asia-southeast2").firestore
    .document("classes/{classId}")
    .onUpdate(async (change, context) => {
      // Get the data before and after the change.
      const dataBefore = change.before.data();
      const dataAfter = change.after.data();

      // Get the list of members before and after.
      const membersBefore = dataBefore.members || [];
      const membersAfter = dataAfter.members || [];

      // If the member list hasn't changed, do nothing.
      if (membersBefore.length <= membersAfter.length) {
        functions.logger.log("No members were kicked. Exiting function.");
        return null;
      }

      // Determine which members were kicked.
      const kickedMemberIds = membersBefore.filter(
          (memberId) => !membersAfter.includes(memberId),
      );

      if (kickedMemberIds.length === 0) {
        functions.logger.log("Update detected, but no members were kicked.");
        return null;
      }

      functions.logger.log(`Kicking members: ${kickedMemberIds.join(", ")}`);

      // Create a batch of promises to update each kicked user's profile.
      const promises = kickedMemberIds.map((userId) => {
        const userDocRef = admin.firestore().collection("users").doc(userId);
        return userDocRef.update({
          // Use FieldValue to atomically remove the class ID from the array.
          joinedClasses: admin.firestore.FieldValue.arrayRemove(context.params.classId),
        });
      });

      // Execute all the updates.
      try {
        await Promise.all(promises);
        functions.logger.log("Successfully cleaned up profiles for kicked members.");
        return {status: "success"};
      } catch (error) {
        functions.logger.error("Error cleaning up user profiles:", error);
        return {status: "error"};
      }
    });
