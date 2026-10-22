
const { S3Client } = require('@aws-sdk/client-s3');

const s3 = new S3Client({
    region: 'ap-south-1',
    profile: 'driveclone-local-dev'
});

module.exports = s3;
