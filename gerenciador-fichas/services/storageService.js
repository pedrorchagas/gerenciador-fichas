const crypto = require('crypto');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

// Object Storage da Magalu Cloud: API compatível com S3, então o SDK da AWS
// serve — só muda o endpoint e as credenciais (api key do MGC).
const REGION = process.env.MGC_REGION || 'br-se1';
const ENDPOINT = process.env.MGC_ENDPOINT || `https://${REGION}.magaluobjects.com`;
const BUCKET = process.env.MGC_BUCKET;

const client = new S3Client({
  region: REGION,
  endpoint: ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.MGC_ACCESS_KEY_ID,
    secretAccessKey: process.env.MGC_SECRET_ACCESS_KEY,
  },
});

async function uploadItemImage(itemId, file) {
  const ext = file.originalname.includes('.') ? file.originalname.split('.').pop() : 'jpg';
  const key = `itens/${itemId}/${crypto.randomUUID()}.${ext}`;

  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
  }));

  return key;
}

async function deleteItemImage(key) {
  if (!key) return;
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

// URL pública fixa (path-style, o formato que a Magalu documenta). String pura,
// sem chamada de rede — pode ser montada em toda resposta sem custo.
function buildImageUrl(key) {
  if (!key) return null;
  return `${ENDPOINT}/${BUCKET}/${key}`;
}

module.exports = { uploadItemImage, deleteItemImage, buildImageUrl };
