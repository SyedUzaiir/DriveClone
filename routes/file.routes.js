
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');

const authMiddleware = require('../middleware/auth.middleware');
const File = require('../models/file.model');
const { uploadFile } = require('../services/s3.service');

const router = express.Router();

// Keep uploaded files in memory temporarily.
// Limit each upload to 10 MB.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024,
        files: 1
    }
});

// Upload one file.
router.post(
    '/upload',
    authMiddleware,
    upload.single('file'),
    async (req, res) => {
        let s3Key;

        try {
            if (!req.file) {
                return res.status(400).json({
                    message: 'Please select a file to upload.'
                });
            }

            const userId = req.user.userId;

            // Remove any directory components from the supplied filename.
            const originalName = path.basename(
                req.file.originalname
            );

            // Generate a unique S3 key for this user's file.
            s3Key = `users/${userId}/${crypto.randomUUID()}`;

            // Upload the file contents to private S3 storage.
            await uploadFile({
                key: s3Key,
                body: req.file.buffer,
                contentType: req.file.mimetype
            });

            // Save file information in MongoDB.
            const savedFile = await File.create({
                originalName,
                s3Key,
                mimeType: req.file.mimetype,
                size: req.file.size,
                owner: userId
            });

            return res.status(201).json({
                message: 'File uploaded successfully.',
                file: {
                    id: savedFile._id,
                    name: savedFile.originalName,
                    size: savedFile.size,
                    mimeType: savedFile.mimeType,
                    uploadedAt: savedFile.createdAt
                }
            });
        } catch (error) {
            console.error('File upload error:', error.message);

            // If S3 succeeded but the MongoDB save failed,
            // try to remove the orphaned S3 object.
            if (s3Key) {
                try {
                    const { s3, BUCKET_NAME } =
                        require('../services/s3.service');
                    const { DeleteObjectCommand } =
                        require('@aws-sdk/client-s3');

                    await s3.send(
                        new DeleteObjectCommand({
                            Bucket: BUCKET_NAME,
                            Key: s3Key
                        })
                    );
                } catch (cleanupError) {
                    console.error(
                        'S3 cleanup error:',
                        cleanupError.message
                    );
                }
            }

            if (error.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({
                    message: 'File size must not exceed 10 MB.'
                });
            }

            return res.status(500).json({
                message: 'Unable to upload file.'
            });
        }
    }
);

module.exports = router;
