const mongoose = require('mongoose');

// _id is the YouTube ID: Mongo's built-in unique index spans both source kinds.
// Ownership is of content, never of a course attachment. No TTL: detaching a
// course or replacing a ShortAsset generation must not recycle a remote backup.
const schema = new mongoose.Schema({
  _id: { type: String, required: true },
  contentKey: { type: String, required: true },
}, { timestamps: true, autoIndex: false, autoCreate: false });

module.exports = mongoose.model('YouTubeBackup', schema);
