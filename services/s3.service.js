const {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand
} = require('@aws-sdk/client-s3');

const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { fromIni } = require('@aws-sdk/credential-providers');

const s3 = new S3Client({
    region: 'ap-south-1',
    credentials: fromIni({
        profile: 'driveclone-local-dev'
    })
});

const BUCKET_NAME = 'driveclone-uzair-dev-2026';

async function uploadFile({ key, body, contentType }) {
    const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: body,
        ContentType: contentType
    });

    await s3.send(command);

    return {
        bucket: BUCKET_NAME,
        key
    };
}

async function getDownloadUrl({ key, downloadName }) {
    const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${downloadName.replace(/["\\\r\n]/g, '_')}"`
    });

    return getSignedUrl(s3, command, {
        expiresIn: 60
    });
}

async function deleteFile({ key }) {
    const command = new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key
    });

    await s3.send(command);
}

module.exports = {
    s3,
    uploadFile,
    getDownloadUrl,
    BUCKET_NAME
};
