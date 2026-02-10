const { S3Client, ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const sharp = require('sharp');

// S3 Configuration from environment
const s3Client = new S3Client({
    region: 'auto',
    endpoint: process.env.S3_ENDPOINT_URL,
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true, // Required for S3-compatible services like Railway
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME;

/**
 * List all assets in the bucket, optionally filtered by prefix
 */
async function listAssets(prefix = '') {
    const command = new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: prefix,
    });

    const response = await s3Client.send(command);
    return response.Contents || [];
}

/**
 * Upload a file to the bucket
 */
async function uploadAsset(fileBuffer, key, contentType) {
    const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: fileBuffer,
        ContentType: contentType,
    });

    return await s3Client.send(command);
}

/**
 * Delete a file from the bucket
 */
async function deleteAsset(key) {
    const command = new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
    });

    return await s3Client.send(command);
}

/**
 * Get a public URL for an asset
 */
function getAssetUrl(key) {
    if (!key) return null;
    return `${process.env.S3_ENDPOINT_URL}/${BUCKET_NAME}/${key}`;
}

/**
 * Fetch an object from S3
 */
async function getAsset(key) {
    const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
    });

    const response = await s3Client.send(command);
    return response.Body;
}

/**
 * Generate a thumbnail from an image buffer
 */
async function generateThumbnail(imageBuffer, width = 400) {
    return await sharp(imageBuffer)
        .resize(width)
        .webp({ quality: 80 })
        .toBuffer();
}

/**
 * Check if S3 is configured
 */
function isConfigured() {
    return !!(process.env.S3_ENDPOINT_URL && 
              process.env.S3_ACCESS_KEY_ID && 
              process.env.S3_SECRET_ACCESS_KEY && 
              process.env.S3_BUCKET_NAME);
}

module.exports = {
    listAssets,
    uploadAsset,
    deleteAsset,
    getAssetUrl,
    getAsset,
    generateThumbnail,
    isConfigured,
    BUCKET_NAME
};
