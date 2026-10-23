# 02 — Architecture and Design

## 1. High-Level Architecture

DriveClone follows a **server-rendered monolith** pattern. A single Express process handles HTTP routing, authentication, business logic, and HTML rendering. It coordinates two external data stores:

- **MongoDB** — Stores user documents (credentials) and file metadata documents (name, size, S3 key, owner reference).
- **AWS S3** — Stores the actual file binary data in a private bucket.

The browser communicates with Express via standard HTTP. For file downloads, Express generates a presigned S3 URL and issues an HTTP 302 redirect, causing the browser to fetch the file directly from S3.

---

## 2. Component Responsibilities

| Component | Responsibility |
|---|---|
| `app.js` | Express initialization, middleware registration, route mounting, database connection, server startup |
| `routes/user.routes.js` | Registration form render, user creation, login form render, credential verification, JWT issuance, logout |
| `routes/file.routes.js` | File upload (Multer + S3), file listing (owner-scoped), download (presigned URL + redirect), file deletion (S3 + MongoDB) |
| `routes/index.routes.js` | Render authenticated dashboard (`/home`) |
| `middleware/auth.middleware.js` | Extract JWT from cookie, verify signature, attach decoded payload to `req.user`, redirect to login on failure |
| `models/user.model.js` | Mongoose schema for users: `username`, `email`, `password` |
| `models/file.model.js` | Mongoose schema for files: `originalName`, `s3Key`, `mimeType`, `size`, `owner` (ObjectId ref), timestamps |
| `services/s3.service.js` | S3Client initialization, `uploadFile()`, `getDownloadUrl()`, `deleteFile()` |
| `config/db.js` | MongoDB connection via Mongoose |
| `views/*.ejs` | EJS templates for landing page, login, registration, and file dashboard |

---

## 3. Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                          BROWSER                                 │
│                                                                  │
│  index.ejs ──── login.ejs ──── register.ejs ──── home.ejs       │
│  (Landing)      (Sign In)      (Create Acct)    (Dashboard)     │
│                                                                  │
│  ┌──────────────────────────────────────────────────────┐       │
│  │ Frontend JS: fetch(), FormData, Drag&Drop, DOM      │       │
│  └──────────────┬───────────────────────────────────────┘       │
└─────────────────┼────────────────────────────────────────────────┘
                  │ HTTP (JSON, multipart/form-data, cookies)
                  ▼
┌──────────────────────────────────────────────────────────────────┐
│                     EXPRESS SERVER (Node.js)                      │
│                                                                  │
│  app.use(express.json())                                        │
│  app.use(cookieParser())                                        │
│  app.use(express.urlencoded({ extended: true }))                │
│                                                                  │
│  ┌─────────────┐  ┌────────────────┐  ┌───────────────┐       │
│  │ user.routes │  │ file.routes    │  │ index.routes  │       │
│  │ /user/*     │  │ /files/*       │  │ /home         │       │
│  └──────┬──────┘  └───────┬────────┘  └──────┬────────┘       │
│         │                 │                   │                  │
│         │         ┌───────┴────────┐          │                  │
│         │         │ auth.middleware │◄─────────┘                  │
│         │         │ JWT verify     │                             │
│         │         └───────┬────────┘                             │
│         │                 │                                      │
│         ▼                 ▼                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐       │
│  │ user.model  │  │ file.model   │  │ s3.service       │       │
│  │ (Mongoose)  │  │ (Mongoose)   │  │ (AWS SDK v3)     │       │
│  └──────┬──────┘  └──────┬───────┘  └────────┬─────────┘       │
└─────────┼────────────────┼───────────────────┼──────────────────┘
          │                │                   │
          ▼                ▼                   ▼
   ┌────────────┐   ┌────────────┐     ┌──────────────┐
   │  MongoDB   │   │  MongoDB   │     │   AWS S3     │
   │  users     │   │  files     │     │  (private    │
   │ collection │   │ collection │     │   bucket)    │
   └────────────┘   └────────────┘     └──────────────┘
```

---

## 4. Data Models

### User Schema (`models/user.model.js`)

```javascript
const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        unique: true,
        minlength: [3, 'username should be at least 3 characters long']
    },
    email: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        unique: true,
        minlength: [12, 'email should be at least 12 characters long']
    },
    password: {
        type: String,
        required: true,
        trim: true,
        minlength: [5, 'password should be at least 5 characters long']
    },
});
```

**Key observations:**
- `username` and `email` both have `unique: true`, creating MongoDB unique indexes.
- All string fields use `trim: true` and `lowercase: true`.
- The `password` field stores the **bcrypt hash**, not the raw password. The `minlength: 5` validation applies to the hash string after hashing, which is always longer than 5 characters, so it does not enforce minimum password length at the schema level. Password length is validated by `express-validator` in the route handler.
- **No `timestamps` option** — `createdAt` and `updatedAt` are not automatically generated for users.

### File Schema (`models/file.model.js`)

```javascript
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
```

**Key observations:**
- `s3Key` has `unique: true`, ensuring no two file documents share the same S3 object key.
- `owner` is an `ObjectId` referencing the `user` collection. This establishes a **one-to-many** relationship: one user owns many files.
- `timestamps: true` automatically adds `createdAt` and `updatedAt` fields.
- The API returns `createdAt` as `uploadedAt` in its JSON response mapping.

---

## 5. Ownership Enforcement

Every file operation queries with **both** the file's `_id` **and** the authenticated user's `userId`:

```javascript
// From file.routes.js — download endpoint
const file = await File.findOne({
    _id: req.params.id,
    owner: req.user.userId
}).lean();
```

This pattern prevents **IDOR (Insecure Direct Object Reference)** attacks. Even if an attacker knows a valid file `_id`, the query will return `null` unless `owner` matches the authenticated user. This check is applied consistently in the download, delete, and single-file retrieval endpoints.

---

## 6. Why S3 for File Contents + MongoDB for Metadata?

| Concern | S3 | MongoDB |
|---|---|---|
| **Binary storage** | Designed for storing arbitrarily large binary objects with 11 nines (99.999999999%) durability | MongoDB supports binary via GridFS but is not designed for high-throughput file serving |
| **Queryability** | Cannot query by metadata; objects are identified only by key | Rich query language for filtering, sorting, projecting |
| **Cost** | ~$0.023/GB/month for Standard storage | Database storage is more expensive per GB |
| **Scalability** | Effectively unlimited storage, managed by AWS | Requires sharding and replica sets at scale |
| **Direct access** | Presigned URLs allow the browser to download directly from S3, bypassing Express | Not applicable |

**Chosen approach:** Store file bytes in S3 and store queryable metadata (name, size, type, owner, timestamps) in MongoDB. This keeps the database lean and leverages S3's managed durability and direct-download capability.

---

## 7. S3 Configuration Details

### Object Keys

Generated in `file.routes.js` using:

```javascript
s3Key = `users/${userId}/${crypto.randomUUID()}`;
```

- Keys are prefixed with `users/{userId}/` for logical partitioning by user.
- `crypto.randomUUID()` produces a UUID v4, ensuring uniqueness without exposing the original filename in the key.
- The original filename is stored in MongoDB's `originalName` field instead.

### Bucket Privacy

The S3 bucket (`driveclone-uzair-dev-2026`) is assumed to be private (no public read ACL). All client-facing download access is granted through **presigned URLs**.

### Presigned URLs

```javascript
// From s3.service.js
async function getDownloadUrl({ key, downloadName }) {
    const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${downloadName.replace(/["\\\\\\r\\n]/g, '_')}"`
    });

    return getSignedUrl(s3, command, {
        expiresIn: 60  // 60 seconds
    });
}
```

- The presigned URL is a **bearer capability**: anyone who obtains it can download the file within 60 seconds.
- `ResponseContentDisposition` forces the browser to treat the response as a downloadable attachment with the original filename.
- Special characters in filenames are sanitized to prevent header injection.

### IAM Access

```javascript
const s3 = new S3Client({
    region: 'ap-south-1',
    credentials: fromIni({
        profile: 'driveclone-local-dev'
    })
});
```

- Credentials are loaded from the local AWS CLI credentials file (`~/.aws/credentials`) using the named profile `driveclone-local-dev`.
- **Limitation:** This is a development-only approach. Production should use IAM roles (e.g., EC2 instance profile or ECS task role) or environment variables.

---

## 8. Request Flow Diagrams

### Registration Flow

```
Browser                  Express                    MongoDB
  │                        │                          │
  │  GET /user/register    │                          │
  │───────────────────────>│                          │
  │  <── render register   │                          │
  │                        │                          │
  │  POST /user/register   │                          │
  │  {username,email,pass} │                          │
  │───────────────────────>│                          │
  │                        │── express-validator ──>  │
  │                        │   check fields           │
  │                        │                          │
  │                        │── bcrypt.hash(pass,10)   │
  │                        │                          │
  │                        │── userModel.create({     │
  │                        │     username, email,     │
  │                        │     password: hash  })───>│
  │                        │                          │── save document
  │                        │  <── { _id, ... }        │
  │  <── 201 JSON          │                          │
  │  { message, user }     │                          │
```

### Login Flow

```
Browser                  Express                    MongoDB
  │                        │                          │
  │  POST /user/login      │                          │
  │  {username, password}  │                          │
  │───────────────────────>│                          │
  │                        │── findOne({username}) ──>│
  │                        │  <── user document       │
  │                        │                          │
  │                        │── bcrypt.compare(        │
  │                        │     password,            │
  │                        │     user.password)       │
  │                        │                          │
  │                        │── jwt.sign({             │
  │                        │     userId, email,       │
  │                        │     username},           │
  │                        │     JWT_SECRET,          │
  │                        │     {expiresIn:'1d'})    │
  │                        │                          │
  │                        │── res.cookie('token',    │
  │                        │     token, {httpOnly,    │
  │                        │     sameSite:'lax',      │
  │                        │     maxAge: 24h})        │
  │                        │                          │
  │  <── 302 redirect      │                          │
  │      /home             │                          │
  │      Set-Cookie: token │                          │
```

### File Upload Flow

```
Browser                  Express / Multer           S3              MongoDB
  │                        │                        │                 │
  │  POST /files/upload    │                        │                 │
  │  multipart/form-data   │                        │                 │
  │  (file field)          │                        │                 │
  │───────────────────────>│                        │                 │
  │                        │── auth.middleware ──>  │                 │
  │                        │   verify JWT cookie    │                 │
  │                        │                        │                 │
  │                        │── multer.single('file')│                 │
  │                        │   parse into           │                 │
  │                        │   req.file.buffer      │                 │
  │                        │   (max 10 MB)          │                 │
  │                        │                        │                 │
  │                        │── Generate S3 key:     │                 │
  │                        │   users/{userId}/{uuid}│                 │
  │                        │                        │                 │
  │                        │── PutObjectCommand ───>│                 │
  │                        │                        │── store object  │
  │                        │  <── success           │                 │
  │                        │                        │                 │
  │                        │── File.create({        │                 │
  │                        │     originalName,      │                 │
  │                        │     s3Key, mimeType,   │                 │
  │                        │     size, owner }) ────────────────────>│
  │                        │                        │                 │── save
  │                        │  <── savedFile         │                 │
  │                        │                        │                 │
  │  <── 201 JSON          │                        │                 │
  │  {message, file}       │                        │                 │
```

**If MongoDB save fails after S3 upload succeeds:**

```javascript
// Cleanup orphaned S3 object (from file.routes.js)
if (s3Key) {
    try {
        const { s3, BUCKET_NAME } = require('../services/s3.service');
        const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
        await s3.send(new DeleteObjectCommand({
            Bucket: BUCKET_NAME,
            Key: s3Key
        }));
    } catch (cleanupError) {
        console.error('S3 cleanup error:', cleanupError.message);
    }
}
```

### File Download Flow

```
Browser                  Express                    S3
  │                        │                        │
  │  GET /files/:id/       │                        │
  │      download          │                        │
  │───────────────────────>│                        │
  │                        │── auth.middleware       │
  │                        │── File.findOne({       │
  │                        │     _id, owner})       │
  │                        │                        │
  │                        │── getSignedUrl(         │
  │                        │     GetObjectCommand,   │
  │                        │     {expiresIn: 60})    │
  │                        │                        │
  │  <── 302 redirect      │                        │
  │      Location: presigned URL                    │
  │                        │                        │
  │  GET presigned URL ──────────────────────────>  │
  │  <── 200 binary data (directly from S3)         │
```

### File Delete Flow

```
Browser                  Express                    S3              MongoDB
  │                        │                        │                 │
  │  DELETE /files/:id     │                        │                 │
  │───────────────────────>│                        │                 │
  │                        │── auth.middleware       │                 │
  │                        │── File.findOne({       │                 │
  │                        │     _id, owner})  ────────────────────>│
  │                        │  <── file document     │                 │
  │                        │                        │                 │
  │                        │── deleteFile({key}) ──>│                 │
  │                        │                        │── delete object │
  │                        │  <── success           │                 │
  │                        │                        │                 │
  │                        │── file.deleteOne() ───────────────────>│
  │                        │                        │                 │── remove doc
  │                        │  <── success           │                 │
  │                        │                        │                 │
  │  <── 200 JSON          │                        │                 │
  │  {message, id}         │                        │                 │
```

**Important:** S3 deletion happens **before** MongoDB deletion. If the MongoDB deletion fails, the S3 object is already gone. This is a deliberate ordering choice — it is safer to have a dangling database record (which can be cleaned up) than an orphaned S3 object (which is harder to discover).

---

## 9. API Endpoints

All endpoints are documented from the actual route files.

### Public Routes

| Method | Path | Description | Auth |
|---|---|---|---|
| `GET` | `/` | Landing page; redirects to `/home` if JWT cookie is valid | No |
| `GET` | `/register` | Redirects to `/user/register` | No |
| `GET` | `/user/register` | Renders registration form (`register.ejs`) | No |
| `POST` | `/user/register` | Creates user; returns 201 JSON or 400/500 error | No |
| `GET` | `/user/login` | Renders login form (`login.ejs`) | No |
| `POST` | `/user/login` | Authenticates user; sets JWT cookie; redirects to `/home` | No |

### Authenticated Routes (require valid JWT cookie)

| Method | Path | Description | Request | Response |
|---|---|---|---|---|
| `GET` | `/home` | Renders dashboard (`home.ejs`) | — | HTML |
| `POST` | `/files/upload` | Upload one file | `multipart/form-data`, field `file` | 201 `{message, file}` |
| `GET` | `/files` | List all files for authenticated user | — | 200 `{files: [...]}` |
| `GET` | `/files/:id/download` | Generate presigned URL and redirect | — | 302 redirect to S3 |
| `DELETE` | `/files/:id` | Delete S3 object and MongoDB document | — | 200 `{message, id}` |
| `POST` | `/user/logout` | Clear JWT cookie, redirect to login | — | 302 redirect |

### Error Responses

| Status | Usage |
|---|---|
| `400` | Validation errors (registration/login), missing credentials |
| `404` | File not found (wrong ID or not owned by user), invalid ObjectId |
| `413` | File exceeds 10 MB limit (Multer `LIMIT_FILE_SIZE`) |
| `500` | Internal server errors (database, S3, or unexpected failures) |

---

## 10. Error Propagation

### Express Level
- Every async route handler uses `try/catch`. Caught errors return an appropriate JSON response with an HTTP status code.
- Multer errors (e.g., `LIMIT_FILE_SIZE`) are caught in the upload route's catch block and mapped to a 413 response.
- `CastError` from Mongoose (invalid ObjectId format) is caught and mapped to 404.

### MongoDB Level
- Connection failure at startup causes `process.exit(1)`.
- Query errors in route handlers are caught and returned as 500.
- Unique constraint violations (duplicate username/email) trigger a MongoDB error that results in a 500 response.

### S3 Level
- S3 errors (permission denied, network failure) are caught in route handlers and returned as 500.
- On upload cleanup failure, the error is logged but does not affect the HTTP response (the client already received the original error).

### Missing Error Handling
- There is no global Express error handler (`app.use((err, req, res, next) => {...})`).
- Unhandled promise rejections are not explicitly caught at the process level.

---

## 11. Data Consistency: S3 + MongoDB

### The Fundamental Problem

S3 and MongoDB are **independent systems**. There is no distributed transaction protocol that makes an S3 operation and a MongoDB operation atomic. When an operation requires changes to both systems, there is always a window where one has been updated but the other has not.

### How DriveClone Handles It

**Upload (S3 first, then MongoDB):**
1. Upload file to S3.
2. Save metadata to MongoDB.
3. **If step 2 fails:** Attempt to delete the orphaned S3 object.
4. **If cleanup also fails:** Log the error. An orphaned object remains in S3.

**Delete (S3 first, then MongoDB):**
1. Find the file document in MongoDB (verify ownership).
2. Delete the S3 object.
3. Delete the MongoDB document.
4. **If step 3 fails:** The S3 object is already deleted. A dangling database record remains.

### Why This Ordering?

- **Upload:** S3 first, because if the database save fails, the cleanup code can attempt to remove the orphan. If the order were reversed (database first, then S3 fails), you would have a metadata record pointing to a non-existent object.
- **Delete:** S3 first, because a dangling database record is easier to detect and clean up than an orphaned S3 object. The database record can be identified by querying for files whose S3 keys no longer exist.

### Remaining Risks

- If the server crashes between S3 upload and MongoDB save, an orphaned S3 object remains without any cleanup attempt.
- If the server crashes between S3 deletion and MongoDB deletion, a dangling database record remains.
- There is no background reconciliation process to detect and repair inconsistencies.

---

## 12. Architecture Limitations & Evolution Path

### Current Limitations

1. **Single-process server** — No horizontal scaling, no load balancing.
2. **In-memory file buffering** — Every upload consumes server RAM proportional to the file size (up to 10 MB).
3. **No queueing** — Upload and delete operations are synchronous within the request lifecycle.
4. **No caching** — File listings are always fetched from MongoDB.
5. **Hardcoded AWS configuration** — Region and bucket name are constants, not environment variables.
6. **No static asset serving** — Tailwind CSS and fonts are loaded from CDNs.
7. **EJS rendering** — Server renders full HTML pages; no client-side routing or SPA behavior.

### Evolution Path

| Phase | Change | Benefit |
|---|---|---|
| **1** | Move S3 config to env vars; add `helmet`, `cors`, rate limiting | Basic production hardening |
| **2** | Switch to presigned PUT URLs for direct browser → S3 uploads | Eliminate server memory pressure |
| **3** | Add Redis for session caching / token blacklist | Enable JWT revocation, horizontal scaling |
| **4** | Background job queue (e.g., Bull/BullMQ) for S3 cleanup | Reliable orphan cleanup, async processing |
| **5** | CloudFront CDN in front of S3 | Lower latency downloads, reduced S3 transfer costs |
| **6** | React/Next.js frontend with Express as API | Richer client-side experience, separation of concerns |
| **7** | Container deployment (Docker + ECS/EKS) | Reproducible environments, auto-scaling |
| **8** | S3 multipart uploads | Support files larger than 10 MB |
