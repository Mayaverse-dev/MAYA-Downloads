/**
 * S3 Bucket Explorer
 * Lists all files and folders in the configured S3 bucket
 */

require('dotenv').config();

const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

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

async function listBucketContents() {
    console.log('='.repeat(60));
    console.log('S3 BUCKET EXPLORER');
    console.log('='.repeat(60));
    console.log(`Endpoint: ${process.env.S3_ENDPOINT_URL}`);
    console.log(`Bucket: ${BUCKET_NAME}`);
    console.log('='.repeat(60));
    console.log('');

    try {
        const command = new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
        });

        const response = await s3Client.send(command);

        if (!response.Contents || response.Contents.length === 0) {
            console.log('📭 Bucket is empty - no files found');
            return;
        }

        console.log(`Found ${response.Contents.length} file(s):\n`);

        // Group by folder
        const folders = {};
        const rootFiles = [];

        response.Contents.forEach(item => {
            const key = item.Key;
            const parts = key.split('/');

            if (parts.length > 1) {
                const folder = parts[0];
                if (!folders[folder]) folders[folder] = [];
                folders[folder].push({
                    name: parts.slice(1).join('/'),
                    size: item.Size,
                    modified: item.LastModified,
                    fullKey: key
                });
            } else {
                rootFiles.push({
                    name: key,
                    size: item.Size,
                    modified: item.LastModified,
                    fullKey: key
                });
            }
        });

        // Display root files
        if (rootFiles.length > 0) {
            console.log('📁 ROOT FILES');
            console.log('-'.repeat(40));
            rootFiles.forEach(file => {
                const sizeKb = (file.size / 1024).toFixed(1);
                console.log(`   📄 ${file.name} (${sizeKb} KB)`);
            });
            console.log('');
        }

        // Display folders
        const folderNames = Object.keys(folders).sort();
        folderNames.forEach(folder => {
            const files = folders[folder];
            console.log(`📁 ${folder.toUpperCase()}/ (${files.length} files)`);
            console.log('-'.repeat(40));
            files.forEach(file => {
                if (file.name) { // Skip if it's just the folder marker
                    const sizeKb = (file.size / 1024).toFixed(1);
                    console.log(`   📄 ${file.name} (${sizeKb} KB)`);
                }
            });
            console.log('');
        });

        // Summary
        console.log('='.repeat(60));
        console.log('SUMMARY');
        console.log('='.repeat(60));
        console.log(`Total files: ${response.Contents.length}`);
        console.log(`Folders: ${folderNames.length > 0 ? folderNames.join(', ') : 'none'}`);
        console.log(`Root files: ${rootFiles.length}`);

        const totalSize = response.Contents.reduce((sum, item) => sum + item.Size, 0);
        console.log(`Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);

    } catch (error) {
        console.error('❌ Error connecting to S3:');
        console.error(`   ${error.message}`);

        if (error.name === 'CredentialsProviderError') {
            console.error('\n⚠️  Check your S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY in .env');
        } else if (error.name === 'NoSuchBucket') {
            console.error('\n⚠️  Bucket does not exist. Check S3_BUCKET_NAME in .env');
        } else if (error.code === 'ENOTFOUND') {
            console.error('\n⚠️  Cannot reach S3 endpoint. Check S3_ENDPOINT_URL in .env');
        }
    }
}

listBucketContents();
