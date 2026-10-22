
const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema(
    {
        originalName: {
            type: String,
            required: true
        },
        s3Key: {
            type: String,
            required: true,
            unique: true
        },
        mimeType: {
            type: String,
            required: true
        },
        size: {
            type: Number,
            required: true
        },
        owner: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'user',
            required: true
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model('file', fileSchema);
