
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
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

module.exports = {
    s3,
    uploadFile,
    BUCKET_NAME
};
