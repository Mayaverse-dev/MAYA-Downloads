/**
 * S3 Bucket Migration Script
 * Transfers all objects from old Tigris bucket to new bucket.
 * 
 * Usage:
 *   1. Set environment variables (see below)
 *   2. Run: node scripts/migrate-s3.js
 * 
 * Required environment variables:
 *   OLD_S3_ACCESS_KEY_ID     - Access key for old bucket
 *   OLD_S3_SECRET_ACCESS_KEY - Secret key for old bucket
 *   OLD_S3_BUCKET            - Old bucket name
 *   NEW_S3_ACCESS_KEY_ID     - Access key for new bucket
 *   NEW_S3_SECRET_ACCESS_KEY - Secret key for new bucket
 *   NEW_S3_BUCKET            - New bucket name
 *   S3_ENDPOINT              - Endpoint URL (default: https://t3.storageapi.dev)
 */

require('dotenv').config();

const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');

// Configuration
const ENDPOINT = process.env.S3_ENDPOINT || 'https://t3.storageapi.dev';

const OLD_BUCKET = process.env.OLD_S3_BUCKET || 'maya-store-bucket-ztnqpht';
const NEW_BUCKET = process.env.NEW_S3_BUCKET || 'embedded-drop-iunbltzf2y1';

// Create S3 clients
const oldClient = new S3Client({
  endpoint: ENDPOINT,
  region: 'auto',
  credentials: {
    accessKeyId: process.env.OLD_S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.OLD_S3_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});

const newClient = new S3Client({
  endpoint: ENDPOINT,
  region: 'auto',
  credentials: {
    accessKeyId: process.env.NEW_S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.NEW_S3_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function listAllObjects(client, bucket) {
  const objects = [];
  let continuationToken;

  do {
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      ContinuationToken: continuationToken,
    });
    const response = await client.send(command);
    
    if (response.Contents) {
      objects.push(...response.Contents);
    }
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return objects;
}

async function copyObject(key) {
  console.log(`  Copying: ${key}`);
  
  // Get from old bucket
  const getCommand = new GetObjectCommand({
    Bucket: OLD_BUCKET,
    Key: key,
  });
  const getResponse = await oldClient.send(getCommand);
  const body = await streamToBuffer(getResponse.Body);

  // Put to new bucket
  const putCommand = new PutObjectCommand({
    Bucket: NEW_BUCKET,
    Key: key,
    Body: body,
    ContentType: getResponse.ContentType,
    ContentLength: getResponse.ContentLength,
  });
  await newClient.send(putCommand);
  
  console.log(`  ✓ Copied: ${key} (${(body.length / 1024).toFixed(1)} KB)`);
}

async function migrate() {
  console.log('='.repeat(60));
  console.log('S3 Bucket Migration');
  console.log('='.repeat(60));
  console.log(`From: ${OLD_BUCKET}`);
  console.log(`To:   ${NEW_BUCKET}`);
  console.log(`Endpoint: ${ENDPOINT}`);
  console.log('');

  // Validate credentials
  if (!process.env.OLD_S3_ACCESS_KEY_ID || !process.env.OLD_S3_SECRET_ACCESS_KEY) {
    console.error('ERROR: Missing OLD_S3_ACCESS_KEY_ID or OLD_S3_SECRET_ACCESS_KEY');
    console.error('Set these environment variables and try again.');
    process.exit(1);
  }
  if (!process.env.NEW_S3_ACCESS_KEY_ID || !process.env.NEW_S3_SECRET_ACCESS_KEY) {
    console.error('ERROR: Missing NEW_S3_ACCESS_KEY_ID or NEW_S3_SECRET_ACCESS_KEY');
    console.error('Set these environment variables and try again.');
    process.exit(1);
  }

  try {
    // List objects in old bucket
    console.log('Listing objects in old bucket...');
    const objects = await listAllObjects(oldClient, OLD_BUCKET);
    console.log(`Found ${objects.length} objects\n`);

    if (objects.length === 0) {
      console.log('No objects to migrate. Done.');
      return;
    }

    // Copy each object
    let copied = 0;
    let failed = 0;

    for (const obj of objects) {
      try {
        await copyObject(obj.Key);
        copied++;
      } catch (err) {
        console.error(`  ✗ Failed: ${obj.Key} - ${err.message}`);
        failed++;
      }
    }

    console.log('');
    console.log('='.repeat(60));
    console.log(`Migration complete: ${copied} copied, ${failed} failed`);
    console.log('='.repeat(60));

  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  }
}

migrate();
