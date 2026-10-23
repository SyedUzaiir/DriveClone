# 03 — Implementation Details

## A. Node.js and Express

### What Is Node.js?

Node.js is a JavaScript runtime built on Chrome's V8 engine. It uses an **event-driven, non-blocking I/O model**, which makes it well-suited for applications that spend most of their time waiting for network responses (database queries, S3 API calls, HTTP requests) rather than performing CPU-intensive computation.

In DriveClone, the server spends the majority of each request waiting for MongoDB queries, S3 uploads/downloads, or bcrypt hashing. Node's event loop handles these asynchronously, allowing a single process to serve many concurrent connections without spawning a thread per request.

### Module System

DriveClone uses CommonJS (`require` / `module.exports`), which is the default for Node.js with `"type": "commonjs"` in `package.json`.

```javascript
// Importing a module
const express = require('express');

// Exporting from a module
module.exports = router;

// Exporting multiple values
module.exports = { s3, uploadFile, getDownloadUrl, deleteFile, BUCKET_NAME };
```

### Express Initialization and Middleware

From `app.js`:

```javascript
const app = express();

// Parse JSON request bodies (for API responses)
app.use(express.json());

// Parse cookies from the Cookie header into req.cookies
app.use(cookieParser());

// Parse URL-encoded form submissions (login/register forms)
app.use(express.urlencoded({ extended: true }));
```

**Middleware execution order matters.** `cookieParser()` must run before any route handler that reads `req.cookies`. `express.json()` must run before any handler that reads `req.body` from a JSON request.

### Route Mounting

```javascript
app.use('/', indexRouter);      // /home
app.use('/user', userRouter);   // /user/register, /user/login, /user/logout
app.use('/files', fileRouter);  // /files/upload, /files, /files/:id/download, etc.
```

When a request arrives at `/files/upload`, Express:
1. Matches the `/files` prefix in `app.use('/files', fileRouter)`.
2. Strips the prefix and passes `/upload` to `fileRouter`.
3. `fileRouter` matches `POST /upload`.

### Middleware vs. Route Handlers

A **middleware** function has the signature `(req, res, next)`. It can:
- Modify `req` or `res`.
- End the request by calling `res.send()`, `res.redirect()`, etc.
- Pass control to the next middleware/handler by calling `next()`.

A **route handler** is the final middleware in the chain for a specific route. It always sends a response.

```javascript
// Middleware: auth check (from auth.middleware.js)
function authMiddleware(req, res, next) {
    const token = req.cookies?.token;
    if (!token) return res.redirect('/user/login');
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;  // Attach user info for downstream handlers
        next();              // Pass to next middleware or route handler
    } catch (error) {
        res.clearCookie('token', { /* options */ });
        return res.redirect('/user/login');
    }
}

// Route handler: uses req.user set by middleware above
router.get('/', authMiddleware, async (req, res) => {
    const files = await File.find({ owner: req.user.userId });
    return res.status(200).json({ files });
});
```

### Async/Await and Error Handling

All database and S3 operations are asynchronous. DriveClone uses `async/await` with `try/catch`:

```javascript
router.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
    let s3Key;
    try {
        // ... upload logic ...
        await uploadFile({ key: s3Key, body: req.file.buffer, contentType: req.file.mimetype });
        const savedFile = await File.create({ /* ... */ });
        return res.status(201).json({ message: 'File uploaded successfully.', file: { /* ... */ } });
    } catch (error) {
        // Cleanup S3 if needed, return error response
        if (s3Key) { /* cleanup orphan */ }
        return res.status(500).json({ message: 'Unable to upload file.' });
    }
});
```

### HTTP Status Codes Used

| Code | Meaning | Where Used |
|---|---|---|
| `200` | OK | File listing, file deletion |
| `201` | Created | User registration, file upload |
| `204` | No Content | Chrome DevTools `.well-known` endpoint |
| `302` | Redirect | Login success → `/home`, download → presigned URL, logout → `/user/login` |
| `400` | Bad Request | Validation errors, wrong credentials |
| `404` | Not Found | File not found or not owned, invalid ObjectId |
| `413` | Payload Too Large | File exceeds 10 MB |
| `500` | Internal Server Error | Database/S3/unexpected failures |

---

## B. Authentication and Authorization

### Registration Flow

1. Client submits `POST /user/register` with `username`, `email`, `password`.
2. `express-validator` validates: email is valid and ≥10 chars, password ≥5 chars, username ≥3 chars.
3. Password is hashed: `await bcrypt.hash(password, 10)` — 10 salt rounds.
4. User document is created in MongoDB with the hash.
5. Response: 201 JSON with `user.id`, `user.username`, `user.email` (never the hash).

### Login Flow

1. Client submits `POST /user/login` with `username`, `password`.
2. `express-validator` validates field lengths.
3. Find user by username: `await userModel.findOne({ username })`.
4. Compare password: `await bcrypt.compare(password, user.password)`.
5. Sign JWT: `jwt.sign({ userId, email, username }, JWT_SECRET, { expiresIn: '1d' })`.
6. Set cookie: `res.cookie('token', token, { httpOnly: true, secure: production, sameSite: 'lax', maxAge: 24h })`.
7. Redirect to `/home`.

### bcrypt: Salts and Work Factor

```javascript
const hashPassword = await bcrypt.hash(password, 10);
```

- `10` is the **cost factor** (salt rounds). bcrypt generates a random salt and applies 2^10 = 1024 iterations of the Blowfish cipher.
- Each hash includes the salt, so identical passwords produce different hashes.
- This makes brute-force attacks computationally expensive. An attacker must perform 1024 hash iterations per password guess per user.
- `bcrypt.compare()` extracts the salt from the stored hash and re-applies the same process to the input password.

### JWT Structure

A JWT has three Base64URL-encoded parts separated by dots: `header.payload.signature`.

```
Header:   { "alg": "HS256", "typ": "JWT" }
Payload:  { "userId": "...", "email": "...", "username": "...", "iat": ..., "exp": ... }
Signature: HMAC-SHA256(base64url(header) + "." + base64url(payload), JWT_SECRET)
```

- The payload is **signed but not encrypted**. Anyone can decode the Base64URL payload and read the claims. The signature only guarantees the payload has not been tampered with.
- `jwt.verify()` recalculates the signature using the server's `JWT_SECRET` and checks it matches.
- If the `exp` claim has passed, `jwt.verify()` throws a `TokenExpiredError`.

### HTTP-Only Cookies

```javascript
res.cookie('token', token, {
    httpOnly: true,        // Not accessible via document.cookie (JavaScript)
    secure: process.env.NODE_ENV === 'production',  // HTTPS only in production
    sameSite: 'lax',       // Sent with same-site requests and top-level navigations
    path: '/',             // Available for all routes
    maxAge: 24 * 60 * 60 * 1000  // 24 hours
});
```

**What `httpOnly` protects against:** Prevents client-side JavaScript from reading the cookie via `document.cookie`. This means an XSS attack that injects JavaScript cannot exfiltrate the JWT.

**What `httpOnly` does NOT protect against:**
- It does not prevent the browser from **automatically sending** the cookie with cross-origin requests (CSRF).
- `sameSite: 'lax'` mitigates many CSRF vectors (the cookie is not sent on cross-origin POST requests from forms), but does not cover all scenarios.
- A dedicated CSRF token is **not implemented** in DriveClone.

### Authentication vs. Authorization

- **Authentication**: "Who are you?" — Verified by the JWT in the cookie. The `authMiddleware` checks this.
- **Authorization**: "Are you allowed to do this?" — The file query `{ _id: fileId, owner: req.user.userId }` ensures only the owner can access their files.

### IDOR/BOLA Prevention

**IDOR (Insecure Direct Object Reference)** / **BOLA (Broken Object-Level Authorization)**: If the application only checked the file `_id` without verifying `owner`, any authenticated user could access any other user's files by guessing or enumerating file IDs.

DriveClone prevents this by always including `owner: req.user.userId` in file queries.

### Logout and JWT Revocation

```javascript
router.post('/logout', (req, res) => {
    res.clearCookie('token', cookieOptions);
    return res.redirect('/user/login');
});
```

- `clearCookie` removes the JWT from the browser.
- **Limitation:** The JWT itself is still valid until it expires (up to 24 hours). If the token was intercepted, it can be used until expiry.
- **There is no server-side token blacklist or session store.** This is a known limitation.
- **Mitigation options (not implemented):** Token blacklist in Redis, shorter token expiry with refresh tokens, or switching to server-side sessions.

---

## C. File Upload and AWS S3

### Multipart/Form-Data

When a browser submits a file via `<input type="file">` or `FormData`, the HTTP request uses `Content-Type: multipart/form-data`. Express's built-in body parsers (`express.json()`, `express.urlencoded()`) cannot parse this format. That's why **Multer** is needed.

### Multer Configuration

```javascript
const upload = multer({
    storage: multer.memoryStorage(),  // File stored in req.file.buffer (RAM)
    limits: {
        fileSize: 10 * 1024 * 1024,  // 10 MB maximum
        files: 1                      // One file per request
    }
});
```

- **`memoryStorage()`**: The entire uploaded file is buffered in server memory as a `Buffer` object accessible via `req.file.buffer`.
- **Alternative — `diskStorage()`**: Writes the file to a temporary directory on disk. Better for large files but adds disk I/O and requires cleanup.
- **Trade-off**: Memory storage is simpler and faster for small files (≤10 MB) but creates memory pressure under concurrent uploads. With 100 simultaneous 10 MB uploads, the server would need ~1 GB of free RAM.

### Upload Route

```javascript
router.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
    // upload.single('file') means: parse the field named 'file' from multipart data
    // After parsing, req.file contains:
    //   - req.file.buffer:       The file bytes (Buffer)
    //   - req.file.originalname: The client-provided filename
    //   - req.file.mimetype:     The detected MIME type
    //   - req.file.size:         The file size in bytes
});
```

### S3 Object Key Generation

```javascript
const originalName = path.basename(req.file.originalname);  // Strip directory components
s3Key = `users/${userId}/${crypto.randomUUID()}`;            // e.g., "users/abc123/f47ac10b-58cc-4372-a567-0e02b2c3d479"
```

- `path.basename()` prevents directory traversal attacks in the filename.
- The S3 key uses a UUID, not the original filename, to avoid collisions and information leakage.
- The original filename is stored separately in MongoDB's `originalName` field.

### S3 Upload

```javascript
async function uploadFile({ key, body, contentType }) {
    const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: body,           // The Buffer from req.file.buffer
        ContentType: contentType
    });
    await s3.send(command);
    return { bucket: BUCKET_NAME, key };
}
```

- `Body` accepts a `Buffer`, `Readable` stream, or string. DriveClone passes the in-memory `Buffer`.
- The file travels: Browser → Express → Multer (RAM) → S3.
- **The browser does NOT upload directly to S3.** All uploads pass through the Express server.

### S3 Download via Presigned URL

```javascript
async function getDownloadUrl({ key, downloadName }) {
    const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${downloadName.replace(/["\\\\\\r\\n]/g, '_')}"`
    });
    return getSignedUrl(s3, command, { expiresIn: 60 });
}
```

The route handler then redirects:

```javascript
const downloadUrl = await getDownloadUrl({ key: file.s3Key, downloadName: file.originalName });
return res.redirect(downloadUrl);
```

- The presigned URL is a **time-limited, self-authenticating URL**. Anyone with the URL can download the file within 60 seconds.
- After the redirect, the browser fetches the file directly from S3. **The file bytes do not pass through Express on download**, unlike upload.

### S3 Delete

```javascript
async function deleteFile({ key }) {
    const command = new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key
    });
    await s3.send(command);
}
```

**Note:** S3's `DeleteObject` is **idempotent**. Deleting a non-existent key does not throw an error. This means if a cleanup attempt runs after the object was already deleted, it succeeds silently.

### Upload Cleanup Logic

If the MongoDB `File.create()` fails after the S3 upload succeeds, the route handler attempts to delete the orphaned S3 object:

```javascript
if (s3Key) {
    try {
        await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key }));
    } catch (cleanupError) {
        console.error('S3 cleanup error:', cleanupError.message);
    }
}
```

**Limitations:**
- If the server process crashes between the S3 upload and the MongoDB save, no cleanup runs.
- If the cleanup itself fails (network issue), the orphan remains in S3.
- There is no background job or reconciliation process to detect orphans.

### Memory Pressure

With `memoryStorage()`, Multer holds the full file in RAM:
- 10 MB file × 50 concurrent uploads = 500 MB of RAM consumed just by file buffers.
- Node.js default heap is ~1.5 GB. Under heavy load, the server could run out of memory.
- **Alternative approaches (not implemented):** Use `diskStorage()`, or generate presigned PUT URLs and have the browser upload directly to S3.

---

## D. MongoDB and Mongoose

### Documents and Collections

MongoDB stores data as **BSON documents** (binary JSON) organized into **collections**. A document is a set of key-value pairs, similar to a JavaScript object. Unlike SQL tables, documents in the same collection do not need to have identical fields (though Mongoose enforces a consistent schema).

DriveClone has two collections:
- `users` — user credentials
- `files` — file metadata

### Schema, Model, Document

```javascript
// Schema: defines the structure and validation rules
const fileSchema = new mongoose.Schema({ /* field definitions */ }, { timestamps: true });

// Model: a constructor compiled from the schema, bound to a collection
const File = mongoose.model('file', fileSchema);

// Document: an instance of a model, representing one record
const savedFile = await File.create({ originalName, s3Key, mimeType, size, owner: userId });
```

### ObjectId and References

```javascript
owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'user',
    required: true
}
```

- `ObjectId` is a 12-byte unique identifier generated by MongoDB.
- `ref: 'user'` tells Mongoose this field references a document in the `users` collection. This enables `.populate('owner')` (though DriveClone does not use `populate`).
- The actual value stored is the ObjectId, e.g., `"6718a3f2c1e4b5d6e8f90123"`.

### Query Patterns

**Create a document:**
```javascript
const savedFile = await File.create({
    originalName,
    s3Key,
    mimeType: req.file.mimetype,
    size: req.file.size,
    owner: userId
});
```

**Find all documents owned by a user:**
```javascript
const files = await File.find({ owner: req.user.userId })
    .select('originalName mimeType size createdAt')  // Project specific fields
    .sort({ createdAt: -1 })                         // Newest first
    .lean();                                          // Return plain objects, not Mongoose documents
```

**Find one document by ID and owner:**
```javascript
const file = await File.findOne({
    _id: req.params.id,
    owner: req.user.userId
}).lean();
```

**Delete a document:**
```javascript
await file.deleteOne();  // Called on the document instance
```

### `lean()` Explained

By default, Mongoose queries return full Mongoose document objects with methods like `.save()`, `.deleteOne()`, change tracking, and getters/setters. `.lean()` tells Mongoose to return plain JavaScript objects instead. Benefits:
- **Faster**: No Mongoose overhead.
- **Less memory**: Plain objects are lighter.
- **When to use**: Read-only operations where you don't need to modify and save the document.
- **When NOT to use**: When you need to call `file.deleteOne()` on the document instance (the delete route fetches without `.lean()` for this reason).

### Timestamps

```javascript
{ timestamps: true }
```

This adds `createdAt` and `updatedAt` fields automatically. The file listing API maps `createdAt` to `uploadedAt` in the JSON response.

### S3 Keys vs. Database IDs

| Identifier | Purpose |
|---|---|
| MongoDB `_id` | Identifies a metadata document. Used in API URLs (`/files/:id/download`). |
| `s3Key` | Identifies a binary object in S3 (`users/{userId}/{uuid}`). Used internally by the server to interact with S3. |
| `owner` | References the user who owns the file. Used for authorization queries. |

These three identifiers serve different systems. The `_id` is for the API consumer, the `s3Key` is for S3, and the `owner` is for authorization.

---

## E. EJS and Tailwind CSS

### Server-Side Rendering

DriveClone uses **EJS (Embedded JavaScript)** as its template engine:

```javascript
app.set('view engine', 'ejs');
app.set('views', './views');

// Rendering a template
res.render('home');  // Renders views/home.ejs
```

When `res.render('home')` is called, Express:
1. Reads `views/home.ejs`.
2. Executes any embedded JavaScript (`<%= %>`, `<% %>`).
3. Returns the resulting HTML string as the HTTP response body.

### EJS vs. Frontend JavaScript

The EJS templates in DriveClone are **static** in the sense that no dynamic EJS variables are passed during rendering (e.g., `res.render('home')` passes no data). The file listing, upload, and delete functionality are handled entirely by **frontend JavaScript** using `fetch()` API calls.

This is a hybrid approach:
- **EJS** handles the initial page structure (HTML shell, navbar, forms).
- **Frontend JavaScript** handles dynamic data (file listing, upload progress, search filter, delete modal).

### Why EJS Is Reasonable Here

- No build step required (no Webpack, Vite, or transpilation).
- Simple server-side rendering for four pages.
- Frontend interactivity is handled by vanilla JavaScript.
- For a small full-stack project, EJS avoids the complexity of a separate React/Vue frontend.

### Tailwind CSS

DriveClone loads Tailwind CSS from a CDN with an inline configuration:

```html
<script src="https://cdn.tailwindcss.com"></script>
<script>
  tailwind.config = {
    darkMode: 'class',
    theme: { extend: { fontFamily: { sans: ['Inter', ...] } } }
  }
</script>
```

- `darkMode: 'class'` enables class-based dark mode toggling by adding/removing the `dark` class on the `<html>` element.
- Utility classes like `bg-zinc-50 dark:bg-zinc-950` define both light and dark mode styles.

### Frontend JavaScript Patterns

**File upload with `fetch` and `FormData`:**
```javascript
const formData = new FormData();
formData.append("file", file);  // 'file' matches multer's upload.single('file')

const response = await fetch("/files/upload", {
    method: "POST",
    body: formData,
    // No Content-Type header — the browser sets it with the correct boundary
});
```

**Drag-and-drop:**
```javascript
dropArea.addEventListener("dragover", (event) => {
    event.preventDefault();  // Required to allow drop
    // Visual feedback
});

dropArea.addEventListener("drop", (event) => {
    event.preventDefault();
    const files = event.dataTransfer.files;
    // Process files
});
```

### XSS and User-Controlled Filenames

The file dashboard renders filenames received from the API. In `home.ejs`, filenames are escaped before insertion:

```javascript
function escapeHtml(string) {
    if (!string) return '';
    return String(string)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
```

This prevents XSS through malicious filenames like `<script>alert('xss')</script>.txt`.

---

## F. Security and Failure Handling

### Implemented Safeguards

| Area | Implementation | Notes |
|---|---|---|
| **Password storage** | `bcrypt.hash(password, 10)` | 10 salt rounds; plaintext never stored |
| **Cookie configuration** | `httpOnly: true, sameSite: 'lax'` | `secure` only in production |
| **Authentication** | JWT verified in middleware on every protected route | Redirects to login on failure |
| **Authorization** | All file queries include `owner: req.user.userId` | Prevents IDOR/BOLA |
| **File size** | Multer `limits.fileSize: 10 * 1024 * 1024` | 413 response on violation |
| **Filename sanitization** | `path.basename()` on upload; `escapeHtml()` on display | Prevents traversal and XSS |
| **S3 presigned URL TTL** | `expiresIn: 60` seconds | Limits exposure window |
| **Download header injection** | Filename sanitized in `Content-Disposition` | Strips quotes, backslashes, newlines |
| **Upload orphan cleanup** | S3 object deleted if MongoDB save fails | Best-effort; not guaranteed |

### Recommended Improvements (Not Implemented)

| Area | Recommendation |
|---|---|
| **File type validation** | Whitelist allowed MIME types; check magic bytes, not just the `Content-Type` header |
| **CSRF protection** | Add CSRF tokens to forms, or use `sameSite: 'strict'` (may break some legitimate flows) |
| **Rate limiting** | Use `express-rate-limit` on `/user/login` and `/user/register` to prevent brute-force |
| **Helmet** | Add `helmet` middleware for security-related HTTP headers |
| **CORS** | If the API will be consumed by a separate frontend, configure `cors` middleware |
| **Global error handler** | Add `app.use((err, req, res, next) => {...})` to catch unhandled errors |
| **Environment variables** | Move S3 bucket name, region, and AWS credentials to `.env` instead of hardcoding |
| **JWT revocation** | Implement a token blacklist or switch to short-lived access tokens with refresh tokens |
| **Production logging** | Replace `console.error` with a structured logger (e.g., Winston, Pino) |
| **Input sanitization** | Use `express-mongo-sanitize` to prevent NoSQL injection |
| **Automated tests** | Unit tests for utility functions, integration tests for API endpoints |
