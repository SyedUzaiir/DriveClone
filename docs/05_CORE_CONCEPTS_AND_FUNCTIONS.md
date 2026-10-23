# 05 — Core Concepts and Functions

A technical cheat sheet and interview reference guide covering the foundational engineering concepts, functions, library patterns, and interview definitions used throughout **DriveClone**.

---

## 1. Node.js and Express

### Node.js, npm, package.json, require(), and module.exports
- **Node.js**: An asynchronous, event-driven JavaScript runtime built on Chrome's V8 engine that executes JavaScript outside the browser. It uses a single-threaded event loop to handle non-blocking I/O operations (file reading, network queries, database calls).
- **npm**: The default package manager for Node.js, facilitating package installation, dependency management, and lifecycle script execution.
- **package.json**: The manifest file storing project metadata, dependency versions (`dependencies` like `express`, `mongoose`, `@aws-sdk/client-s3`), and scripts (`npm run start`, `npm run dev`).
- **CommonJS Module System**: DriveClone uses CommonJS:
  - `require('module-name')`: Synchronously resolves and loads a module or file.
  - `module.exports`: The object reference returned when another file `require()`s this module.

```javascript
// Exporting a router from routes/user.routes.js
const express = require('express');
const router = express.Router();

// ... route declarations ...

module.exports = router;
```

```javascript
// Exporting an object with multiple functions/constants from services/s3.service.js
module.exports = {
    s3,
    uploadFile,
    getDownloadUrl,
    deleteFile,
    BUCKET_NAME
};
```

---

### Express Server Initialization
Express creates an abstraction layer over Node's native `http` module, providing routing, middleware chaining, and HTTP utility methods.

```javascript
// app.js
const express = require('express');
const app = express();

// View engine setup
app.set('view engine', 'ejs');
app.set('views', './views');

// Server startup after establishing database connection
async function startServer() {
    try {
        await connectToDB();
        app.listen(3000, () => {
            console.log('Server is running on port 3000');
        });
    } catch (error) {
        console.error('Application startup failed:', error.message);
        process.exit(1);
    }
}
startServer();
```

---

### Routes, Middleware, req, res, and next
- **`req` (Request)**: Object representing the incoming HTTP request (headers, query parameters, path params, cookies, and parsed body).
- **`res` (Response)**: Object through which the HTTP response is formulated and dispatched (`res.status()`, `res.json()`, `res.render()`, `res.redirect()`).
- **`next`**: Callback function invoked to yield control to the subsequent middleware function in the stack.
- **Middleware**: A pipeline of functions executed sequentially between the initial network receipt and final route resolution.

```javascript
// Middleware pattern (middleware/auth.middleware.js)
function authMiddleware(req, res, next) {
    const token = req.cookies?.token;

    if (!token) {
        return res.redirect('/user/login');
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // Attach user context to request
        next();             // Pass execution to downstream handler
    } catch (error) {
        res.clearCookie('token', cookieOptions);
        return res.redirect('/user/login');
    }
}
```

---

### Built-in & Third-Party Middlewares: express.json(), express.urlencoded(), and cookie-parser
```javascript
// app.js
app.use(express.json());                          // Parses incoming application/json payloads into req.body
app.use(cookieParser());                          // Parses Cookie header into req.cookies object
app.use(express.urlencoded({ extended: true }));  // Parses application/x-www-form-urlencoded forms into req.body
```

- **`express.json()`**: Extracts raw JSON stream from the request body and converts it into a JavaScript object attached to `req.body`.
- **`express.urlencoded({ extended: true })`**: Parses standard HTML form POST submissions. `extended: true` leverages the `qs` library to allow rich objects and arrays.
- **`cookie-parser`**: Reads the raw `Cookie` request header, splits key-value pairs, decodes URI components, and exposes them at `req.cookies`.

---

### REST API Methods and HTTP Status Codes
REST (Representational State Transfer) uses standard HTTP methods to express actions against resources:

| Method | Resource / Endpoint | Operation | DriveClone Implementation |
|---|---|---|---|
| `GET` | `/files` | Read collection | Returns JSON array of user's files |
| `GET` | `/files/:id/download` | Read resource | Redirects (302) to presigned S3 download URL |
| `POST` | `/files/upload` | Create resource | Parses multipart buffer, uploads to S3, records in Mongo |
| `DELETE` | `/files/:id` | Delete resource | Deletes S3 object and Mongo document |

#### HTTP Status Codes Used in DriveClone:
- **`200 OK`**: Successful read or delete (`GET /files`, `DELETE /files/:id`).
- **`201 Created`**: Successful resource creation (`POST /user/register`, `POST /files/upload`).
- **`204 No Content`**: Successful request returning no content body (`GET /.well-known/...`).
- **`302 Found` (Redirect)**: Temporary redirect (`GET /` to `/home`, login success to `/home`, download redirect to S3 URL).
- **`400 Bad Request`**: Validation failure or missing input (`express-validator` failures, missing file).
- **`404 Not Found`**: Resource does not exist or user does not own it (`File.findOne` returned `null`, or `CastError`).
- **`413 Payload Too Large`**: Uploaded file exceeds limits (`LIMIT_FILE_SIZE` from Multer > 10 MB).
- **`500 Internal Server Error`**: Unhandled exception, database connection failure, or S3 API error.

---

### Promises, async/await, try/catch, and Asynchronous I/O
Node.js offloads I/O tasks (database network sockets, AWS HTTP API requests) to the operating system kernel or thread pool (libuv). 
- An asynchronous function returns a **Promise** (pending, fulfilled, or rejected).
- `async/await` is syntactic sugar over Promises, pausing linear execution inside the async frame until the Promise resolves, without blocking the underlying event loop.
- `try/catch` provides structured, synchronous-style exception handling around awaited operations.

```javascript
// Synchronous appearance, non-blocking asynchronous execution
router.get('/', authMiddleware, async (req, res) => {
    try {
        const files = await File.find({ owner: req.user.userId })
            .select('originalName mimeType size createdAt')
            .sort({ createdAt: -1 })
            .lean();

        return res.status(200).json({ files });
    } catch (error) {
        console.error('List files error:', error.message);
        return res.status(500).json({ message: 'Unable to retrieve files.' });
    }
});
```

---

## 2. Authentication and Web Security

### bcrypt Hashing and Password Comparison
- Passwords must **never** be stored in plaintext or reversible encryption.
- **bcrypt** is an adaptive, slow, one-way key derivation function based on the Blowfish cipher. It incorporates a per-password salt to prevent rainbow table attacks and uses a work factor (salt rounds) that can be increased over time as hardware improves.

```javascript
const bcrypt = require('bcrypt');

// Hashing during registration (10 salt rounds = 2^10 iterations)
const hashedPassword = await bcrypt.hash(rawPassword, 10);

// Verifying during login (extracts salt from stored hash and compares)
const isMatch = await bcrypt.compare(rawPassword, user.password);
```

---

### JWT Structure, Signing, Verification, and Expiration
A **JSON Web Token (JWT)** is a compact, URL-safe means of representing claims between two parties. It is composed of three Base64URL-encoded parts separated by periods (`.`):
1. **Header**: Algorithm and token type (`{"alg": "HS256", "typ": "JWT"}`).
2. **Payload**: Non-sensitive claims (`userId`, `email`, `username`, `iat`, `exp`).
3. **Signature**: Cryptographic hash calculated as `HMAC-SHA256(base64Url(header) + "." + base64Url(payload), secret)`.

> [!IMPORTANT]
> The payload of a JWT is Base64URL encoded, **NOT encrypted**. Anyone can decode and inspect the payload claims. The signature guarantees **integrity and authenticity** (tamper-proofing), not confidentiality.

```javascript
const jwt = require('jsonwebtoken');

// 1. Signing a token on successful login
const token = jwt.sign(
    {
        userId: user._id,
        email: user.email,
        username: user.username
    },
    process.env.JWT_SECRET,
    { expiresIn: '1d' } // Expire in 24 hours
);

// 2. Verifying a token in middleware
try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // decoded contains { userId, email, username, iat, exp }
} catch (err) {
    // Throws TokenExpiredError or JsonWebTokenError if signature/claims invalid
}
```

---

### HTTP-Only Cookies and res.cookie()
Instead of transmitting JWTs to the client to be stored in browser `localStorage`, DriveClone transmits the JWT in an HTTP-only cookie.

```javascript
const cookieOptions = {
    httpOnly: true,                                // Inaccessible to JavaScript (document.cookie)
    secure: process.env.NODE_ENV === 'production', // Transmit only over HTTPS in production
    sameSite: 'lax',                               // Protects against common cross-site request forgery
    path: '/',                                     // Cookie valid across entire domain
    maxAge: 24 * 60 * 60 * 1000                    // Expiration: 24 hours (in milliseconds)
};

// Setting the cookie upon successful login
res.cookie('token', token, cookieOptions);

// Clearing the cookie upon logout
res.clearCookie('token', cookieOptions);
```

#### Security Directives Breakdown:
- **`httpOnly: true`**: Completely blocks client-side scripts from accessing `document.cookie`. If an XSS vulnerability exists on the page, the malicious script cannot exfiltrate the JWT.
- **`secure: true`**: Instructs the browser to only send the cookie over encrypted TLS/HTTPS connections, preventing cleartext network sniffing.
- **`sameSite: 'lax'`**: Controls whether the cookie is sent with cross-site requests. `lax` sends the cookie on top-level safe GET navigations (e.g., following an external link), but strips it on cross-origin POST form submissions.
- **`maxAge`**: Sets the cookie lifecycle in milliseconds.

---

### Authentication vs. Authorization
- **Authentication ("Who are you?")**: Validating credentials to establish identity. In DriveClone, this is checking the password with bcrypt and validating the JWT in `authMiddleware`.
- **Authorization ("Are you permitted to access this?")**: Determining permissions on a specific resource. In DriveClone, this is enforcing that the requesting `userId` owns the requested file record.

```javascript
// Authorization check in file.routes.js:
// Both file ID and owner ID are required in the query filter
const file = await File.findOne({
    _id: req.params.id,
    owner: req.user.userId
}).lean();

if (!file) {
    return res.status(404).json({ message: 'File not found.' });
}
```

---

### Security Vulnerabilities: XSS, CSRF, IDOR/BOLA

#### 1. Cross-Site Scripting (XSS)
- **Vulnerability**: Attacker injects malicious JavaScript into user-facing web pages.
- **Mitigation in DriveClone**: 
  - JWT stored in an `httpOnly` cookie so scripts cannot read it.
  - User-provided filenames are safely escaped before dynamic DOM insertion using an `escapeHtml()` sanitization utility in `views/home.ejs`.
- **Reality Check**: `httpOnly` prevents token theft, but injected JavaScript can still perform unauthorized actions by triggering `fetch()` calls that the browser automatically annotates with the cookie.

#### 2. Cross-Site Request Forgery (CSRF)
- **Vulnerability**: An external malicious website tricks an authenticated user's browser into executing state-changing HTTP requests against an application where they are logged in.
- **Current State**: `sameSite: 'lax'` prevents cross-origin form POSTs from attaching the cookie.
- **Limitation**: DriveClone does **not** implement anti-CSRF synchronizer tokens. Fully hardened production apps should implement explicit CSRF tokens for all mutating methods (`POST`, `PUT`, `DELETE`).

#### 3. Insecure Direct Object References (IDOR / BOLA)
- **Vulnerability**: An application receives a user-supplied resource identifier (e.g., `/files/:id/download`) and retrieves the resource without verifying ownership. An attacker alters the ID to access other users' files.
- **Mitigation in DriveClone**: Every query filtering by file ID explicitly includes `{ owner: req.user.userId }`. Even if an attacker passes a valid file `_id` belonging to another user, MongoDB returns `null` and Express responds with `404 Not Found`.

---

### Logout and JWT Revocation Limitations
When a user logs out (`POST /user/logout`), DriveClone executes:
```javascript
res.clearCookie('token', cookieOptions);
return res.redirect('/user/login');
```
- **Limitation**: Because JWTs are **stateless**, the token itself remains cryptographically valid until its `exp` timestamp expires (24 hours). If an attacker obtained a copy of the token before logout, clearing the cookie does **not** invalidate the token on the server.
- **Production Solutions (Future Work)**:
  1. **Token Blacklist**: Store revoked JWT identifiers (`jti`) in an in-memory cache like Redis until their natural expiration.
  2. **Short-lived Access Tokens + Refresh Tokens**: Issue 15-minute access tokens alongside revokable database-backed refresh tokens.

---

## 3. AWS S3 and AWS SDK v3

### Object Storage vs. Block Storage
- **Block Storage** (e.g., AWS EBS, local SSD): Exposes raw storage blocks managed like a local disk drive formatted with a filesystem (ext4, NTFS). High random I/O performance, attached to a single host.
- **Object Storage** (e.g., AWS S3): Manages data as discrete, immutable **objects** composed of binary data, a unique key (identifier), and customizable metadata. Accessed over standard HTTP REST APIs, highly scalable, durable (11 nines: 99.999999999%), and independent of server instances.

---

### Buckets, Objects, Keys, and IAM
- **Bucket**: A top-level container for objects in S3 (e.g., `driveclone-uzair-dev-2026`), having a globally unique name across all AWS accounts.
- **Object**: The entity stored in S3, consisting of binary data and metadata.
- **Object Key**: The unique string identifier for an object within a bucket. In DriveClone:
  ```javascript
  const s3Key = `users/${userId}/${crypto.randomUUID()}`;
  ```
  Prefixing with `users/${userId}/` provides logical namespacing, while `crypto.randomUUID()` avoids collisions and sanitizes file identifiers.
- **IAM (Identity and Access Management)**:
  - **IAM User**: A persistent identity with long-term credentials (access key ID and secret access key).
  - **IAM Role**: A temporary identity assumed by trusted entities or AWS compute services (EC2 instance profiles, ECS task roles).
  - **Least Privilege**: Granting only the absolute minimum permissions required. DriveClone requires only:
    - `s3:PutObject`
    - `s3:GetObject`
    - `s3:DeleteObject`
    scoped strictly to `arn:aws:s3:::driveclone-uzair-dev-2026/users/*`.

---

### AWS SDK v3 Commands
DriveClone uses modular AWS SDK v3 packages (`@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`). Unlike v2, v3 supports tree-shaking and command-based interfaces.

```javascript
// services/s3.service.js
const {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { fromIni } = require('@aws-sdk/credential-providers');

// S3Client instantiation using local AWS profile
const s3 = new S3Client({
    region: 'ap-south-1',
    credentials: fromIni({
        profile: 'driveclone-local-dev'
    })
});

const BUCKET_NAME = 'driveclone-uzair-dev-2026';
```

#### 1. Uploading an Object (`PutObjectCommand`)
```javascript
async function uploadFile({ key, body, contentType }) {
    const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: body,              // In-memory Buffer (req.file.buffer)
        ContentType: contentType
    });

    await s3.send(command);

    return { bucket: BUCKET_NAME, key };
}
```

#### 2. Generating a Presigned Download URL (`GetObjectCommand` + `getSignedUrl`)
```javascript
async function getDownloadUrl({ key, downloadName }) {
    const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        // Sets header on S3's HTTP response to force browser download with original name
        ResponseContentDisposition: `attachment; filename="${downloadName.replace(/["\\\r\n]/g, '_')}"`
    });

    // Generates temporary signed query string with 60-second TTL
    return getSignedUrl(s3, command, {
        expiresIn: 60
    });
}
```

#### 3. Deleting an Object (`DeleteObjectCommand`)
```javascript
async function deleteFile({ key }) {
    const command = new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key
    });

    await s3.send(command);
    // Note: S3 DeleteObject is idempotent; deleting a missing key succeeds silently.
}
```

---

### Why Presigned URLs and S3 Key Obfuscation Are Not Enough
- **Presigned URLs as Bearer Tokens**: A presigned URL contains the signature and parameters embedded directly in the query string. Anyone holding that URL within its 60-second validity window can download the object.
- **Application Authorization Precedence**: S3 knows nothing about MongoDB or Express session cookies. The Express application server **must** verify that the authenticated user owns the file before calling `getDownloadUrl()`.
- **S3 Key Obfuscation**: Hiding or randomizing S3 keys (`crypto.randomUUID()`) is security-by-obscurity. Object-level access control must be enforced by bucket policies preventing public reads and relying strictly on server-minted presigned URLs.

---

## 4. Multer and File Uploads

### multipart/form-data
Standard HTML forms transmit key-value text pairs using `application/x-www-form-urlencoded`. When binary files are uploaded, the browser uses `multipart/form-data`. The payload is divided into delimited parts separated by a unique MIME boundary string, with each part specifying its own `Content-Disposition`, `Content-Type`, and binary chunk.

---

### Multer Storage Engines: memoryStorage vs. diskStorage
- **`multer.memoryStorage()`**: Buffers the incoming file stream directly in server RAM, exposing it at `req.file.buffer`.
  - *Pros*: Fast, zero filesystem cleanup required, straightforward upload directly to S3.
  - *Cons*: Consumes server heap memory. High concurrent uploads can exhaust Node.js RAM.
- **`multer.diskStorage()`**: Streams incoming parts directly to temporary files on the local disk.
  - *Pros*: Minimal memory footprint; can handle multi-gigabyte uploads.
  - *Cons*: Adds disk I/O latency and requires explicit code to delete temporary files after S3 upload.

---

### DriveClone's Single-File Configuration & Upload Flow
```javascript
// routes/file.routes.js
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10 MB maximum
        files: 1                     // Single file per HTTP request
    }
});

// Route handler using upload.single('file')
router.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
    // req.file contains: buffer, originalname, mimetype, size
    // ...
});
```

#### Current Architecture: Express-Mediated Upload
```
[Browser] ──(HTTP POST multipart)──> [Express / Multer RAM] ──(PutObjectCommand)──> [AWS S3]
```
1. Browser stages file and sends POST request to `/files/upload`.
2. Multer parses multipart body into server RAM (`req.file.buffer`).
3. Express calls AWS S3 `PutObjectCommand` passing the buffer.
4. Express saves metadata to MongoDB.
5. Express responds with `201 Created`.

#### Alternative Architecture: Direct Browser-to-S3 Upload (Future Evolution)
```
1. [Browser] ──(GET /files/upload-url)──> [Express] (Mints Presigned PUT URL)
2. [Browser] ──(HTTP PUT binary)────────> [AWS S3] (Bypasses Express entirely)
3. [Browser] ──(POST /files/confirm)────> [Express] (Saves metadata to MongoDB)
```
- Eliminates server RAM consumption entirely.
- Removes 10 MB file size bottleneck on the Express server.
- Requires configuring CORS on the S3 bucket to allow direct PUT requests from the browser origin.

---

## 5. MongoDB and Mongoose

### NoSQL Documents and Collections
- **Document**: A JSON-like record (stored internally as binary BSON) representing a single entity.
- **Collection**: An indexed grouping of documents analogous to a relational table, but without requiring rigid relational joins.

---

### Schema, Model, Document, ObjectId, and References
- **Schema**: Defines document structure, data types, default values, and validation rules.
- **Model**: A compiled Mongoose constructor providing an API for querying and manipulating the underlying MongoDB collection.
- **Document**: An individual instance instantiated from a Model.
- **ObjectId**: A 12-byte BSON type uniquely identifying documents.
- **Reference (`ref`)**: Declares a relationship between collections.

```javascript
// models/user.model.js
const mongoose = require('mongoose');

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
    }
});

module.exports = mongoose.model('user', userSchema);
```

```javascript
// models/file.model.js
const mongoose = require('mongoose');

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
            ref: 'user', // References 'user' model
            required: true
        }
    },
    {
        timestamps: true // Adds createdAt and updatedAt automatically
    }
);

module.exports = mongoose.model('file', fileSchema);
```

---

### Mongoose Query Methods and .lean()

#### Query Methods Used:
- **`Model.create(doc)`**: Instantiates and saves a new document.
- **`Model.find(filter)`**: Returns an array of matching documents.
- **`Model.findOne(filter)`**: Returns the first document matching criteria or `null`.
- **`doc.deleteOne()`**: Deletes a specific Mongoose document instance.

```javascript
// Example from routes/file.routes.js:
const files = await File.find({ owner: req.user.userId })
    .select('originalName mimeType size createdAt')
    .sort({ createdAt: -1 })
    .lean();
```

#### What `.lean()` Does:
By default, Mongoose queries return heavy **Mongoose Documents** decorated with internal state, change tracking, getters/setters, and instance methods (`.save()`, `.validate()`).
- Calling `.lean()` returns **plain JavaScript objects (POJOs)**.
- **Pros**: Reduces memory usage by up to 70% and executes significantly faster. Ideal for read-only queries.
- **When NOT to use**: When you need to mutate the document and call `.save()`, or invoke instance methods like `file.deleteOne()`. In DriveClone's delete route, `File.findOne()` is called **without** `.lean()` so that `file.deleteOne()` can be invoked on the document instance.

---

### Dual-Key Scoping and IDOR Mitigation
```javascript
// Secure Query Scoping Pattern:
const file = await File.findOne({
    _id: req.params.id,       // File must match route parameter
    owner: req.user.userId    // AND must belong to authenticated user
});
```
This dual filter ensures that queries cannot be manipulated to read or delete objects belonging to other accounts.

---

### MongoDB and S3 Consistency: The Two-Phase Problem
Because MongoDB and AWS S3 are independent distributed systems, **there is no single distributed atomic transaction** spanning both.

```
Upload Flow:
[S3 PutObject] ──> OK ──> [MongoDB File.create()] ──> FAILS!
                             │
                             ▼ (Orphaned S3 object created)
                     [Cleanup catch block: DeleteObjectCommand]
```

#### DriveClone's Mitigations:
1. **On Upload**: S3 upload executes first. If `File.create()` throws an error, the catch block attempts to invoke `DeleteObjectCommand` on the newly created `s3Key`.
2. **On Deletion**: S3 object deletion executes first. Only if S3 responds successfully does Express execute `file.deleteOne()` on MongoDB.
3. **Failure Edge Cases**:
   - If the Node process crashes immediately after S3 upload but before MongoDB creation, the catch block will not execute, leaving an orphaned object in S3.
   - If S3 deletion succeeds but the database connection drops before `file.deleteOne()` finishes, a dangling database record remains.
   - **Production Solution**: A background reconciliation job (e.g., daily script comparing S3 bucket inventory against active MongoDB `s3Key` values).

---

## 6. Frontend Concepts

### EJS Server-Side Rendering
EJS compiles templates on the Node.js server, injecting data and producing static HTML strings delivered to the browser.
- `<%= expression %>`: Evaluates JavaScript and HTML-escapes output.
- `<%- expression %>`: Evaluates JavaScript and outputs unescaped raw HTML.
- `<% code %>`: Executes control-flow JavaScript (loops, conditionals) without printing output.

In DriveClone, EJS renders the initial page skeleton, top navigation bar, authentication forms, and layout. Client-side vanilla JavaScript handles dynamic file interactions (live search, upload queueing, and delete confirmation).

---

### Tailwind CSS Utility Classes
DriveClone uses Tailwind CSS loaded via CDN with class-based dark mode (`darkMode: 'class'`).

```html
<!-- Example from views/home.ejs -->
<div class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
    <p class="text-sm font-medium text-zinc-900 dark:text-zinc-100">Filenames</p>
</div>
```
- Utility classes eliminate custom CSS bloat.
- Dark mode operates by checking for the `dark` class on the root `<html>` element.
- Theme state is stored in `localStorage` and initialized via an inline anti-FOUT (Flash of Unstyled Theme) script in `<head>`.

---

### Client-Side Interactions: fetch(), FormData, Drag-and-Drop, and Safe DOM Rendering

#### 1. Drag-and-Drop Events:
```javascript
const dropZone = document.getElementById('drop-zone');

['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        dropZone.classList.add('border-blue-500'); // Visual highlight
    });
});

['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        dropZone.classList.remove('border-blue-500');
    });
});

dropZone.addEventListener('drop', (e) => {
    const droppedFiles = Array.from(e.dataTransfer.files);
    stageFiles(droppedFiles);
});
```

#### 2. Batch Uploading with fetch() and FormData:
```javascript
async function uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file); // Matches multer upload.single('file')

    const response = await fetch('/files/upload', {
        method: 'POST',
        body: formData // Browser automatically calculates multipart boundary
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Upload failed');
    }

    return response.json();
}
```

#### 3. Safe Filename Rendering (XSS Prevention):
User-supplied filenames could contain malicious HTML strings (e.g., `<img src=x onerror=alert(1)>.png`). DriveClone sanitizes filenames before inserting them into HTML template strings:

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

---

### EJS vs. A Separate React Frontend
| Architectural Concern | DriveClone's Approach (EJS + Vanilla JS) | Decoupled Architecture (React SPA + Express API) |
|---|---|---|
| **Build Pipeline** | Zero build step; fast development, no bundlers | Requires Vite/Webpack, Babel, npm dependencies |
| **Routing** | Server-side routing via Express | Client-side routing (`react-router-dom`) |
| **State Management** | Simple DOM mutations and local arrays | React component state (`useState`), Redux, or Zustand |
| **SEO & Initial Load** | Fast initial HTML render directly from server | Slower initial JS bundle download (unless Next.js SSR) |
| **UI Complexity** | Best for simple forms and straightforward dashboards | Best for highly interactive, complex, desktop-like UIs |

---

## 7. Core Interview Glossary

- **API (Application Programming Interface)**: A defined interface enabling software programs to communicate and exchange data via structured requests and responses.
- **REST (Representational State Transfer)**: An architectural style for networked systems relying on stateless communication, resource-oriented URIs, standard HTTP methods (`GET`, `POST`, `PUT`, `DELETE`), and standard HTTP status codes.
- **Middleware**: A composable software function in an HTTP pipeline that intercepts requests and responses to perform tasks (logging, parsing, authenticating) before handing execution to the final handler.
- **Request/Response Lifecycle**: The sequence of stages from client request dispatch, network traversal, middleware processing, database I/O, response generation, to client-side DOM rendering.
- **Hashing vs. Encryption**:
  - *Hashing*: A one-way mathematical function mapping variable input data into a fixed-length string. Irreversible by design (used for passwords).
  - *Encryption*: A two-way mathematical process transforming plaintext into ciphertext using a key. Reversible through decryption with the appropriate key.
- **JWT vs. Server-Side Sessions**:
  - *JWT*: Stateless; user claims and cryptographic signatures are encapsulated in the token itself and stored on the client. The server verifies signatures without database lookups.
  - *Session*: Stateful; the client receives a random session ID cookie, while the actual user session data is retained in a server-side store (Redis, database).
- **Cookies vs. localStorage**:
  - *Cookies*: Transmitted automatically with matching HTTP requests; supports `httpOnly` and `SameSite` flags. Capped at ~4 KB.
  - *localStorage*: Persisted strictly inside the browser domain; accessible exclusively via JavaScript (`window.localStorage`). Capped at 5–10 MB; vulnerable to XSS theft.
- **SQL vs. NoSQL**:
  - *SQL*: Relational databases enforcing structured schemas, relational joins, foreign keys, and strict ACID guarantees across tables.
  - *NoSQL*: Document, key-value, or graph stores offering schema flexibility, horizontal partitioning, and rapid development for hierarchical JSON-like data.
- **Promise vs. async/await**:
  - *Promise*: An object representing the eventual completion or failure of an asynchronous operation with `.then()`, `.catch()`, and `.finally()` chaining.
  - *async/await*: Language syntax built on top of Promises allowing asynchronous code to be written and read like synchronous code.
- **Authentication vs. Authorization**: Authentication validates identity ("Who are you?"). Authorization evaluates permissions ("Are you allowed to perform this action?").
- **IAM User vs. IAM Role**:
  - *IAM User*: A permanent identity configured with static credentials (access keys/passwords) for long-term usage.
  - *IAM Role*: A temporary identity assumed by applications, services, or users that dispenses short-lived, auto-rotating security credentials.
- **Presigned URL**: A cryptographic URL signed with an AWS credential that grants time-limited direct access to a specific private S3 resource without exposing AWS account credentials.
- **XSS (Cross-Site Scripting)**: A vulnerability where an application injects unescaped user-supplied input into the browser DOM, allowing malicious script execution.
- **CSRF (Cross-Site Request Forgery)**: An exploit where an external site forces an authenticated browser to transmit unauthorized commands via automatically attached credentials (cookies).
- **IDOR / BOLA (Insecure Direct Object Reference / Broken Object Level Authorization)**: A security flaw where an API accesses an internal object by an ID without verifying that the requesting user has permission to access it.
- **Race Condition**: A concurrency flaw where the output or state of a system depends on the uncontrolled order or timing of competing operations.
- **Idempotency**: An operation that produces identical state results regardless of whether it is executed once or multiple times consecutively (e.g., HTTP `GET`, `DELETE`, or S3 `DeleteObject`).
- **Atomicity**: The all-or-nothing property of a transaction ensuring that if any sub-operation fails, the entire transaction rolls back cleanly without leaving partial changes.
- **Distributed Consistency**: The challenge of keeping multiple independent data stores (e.g., S3 and MongoDB) synchronized without native cross-system transactional guarantees.
- **Horizontal vs. Vertical Scaling**:
  - *Vertical Scaling*: Adding more resources (CPU, RAM) to an existing single machine.
  - *Horizontal Scaling*: Adding more machine instances running the application behind a load balancer.
- **Reverse Proxy**: A gateway server (e.g., Nginx) placed in front of web applications to distribute load, terminate TLS/SSL, cache responses, and enforce security policies.
- **CDN (Content Delivery Network)**: A geographically distributed network of proxy edge servers (e.g., AWS CloudFront) caching static assets near users to minimize latency.

---

## 8. Quick Revision Section

### 15 Rapid-Fire Interview Questions & Answers

1. **Where are binary files stored in DriveClone?**
   In a private AWS S3 bucket; only metadata is stored in MongoDB.
2. **What does Multer's `memoryStorage()` do?**
   Stores uploaded file bytes directly in server RAM as a `Buffer` available at `req.file.buffer`.
3. **What is the file upload size limit in DriveClone?**
   10 megabytes per file, enforced by Multer's `limits.fileSize`.
4. **How are files downloaded securely?**
   Express generates a presigned S3 URL valid for 60 seconds and issues an HTTP 302 redirect.
5. **Why store JWTs in an `httpOnly` cookie instead of `localStorage`?**
   To protect tokens from being accessed or exfiltrated by malicious JavaScript during an XSS attack.
6. **Does an `httpOnly` cookie prevent CSRF attacks?**
   No. Browsers automatically attach cookies to cross-site requests unless mitigated by `SameSite` flags or anti-CSRF tokens.
7. **How does DriveClone prevent IDOR attacks when downloading or deleting files?**
   Every query explicitly includes `{ _id: fileId, owner: req.user.userId }`.
8. **Why does DriveClone use bcrypt instead of SHA-256 for passwords?**
   bcrypt is slow and salted by design (computationally expensive), making brute-force and rainbow table attacks impractical.
9. **What does Mongoose's `.lean()` method do?**
   Returns plain JavaScript objects instead of full Mongoose Documents, saving memory and improving read performance.
10. **Why are S3 keys formatted as `users/${userId}/${crypto.randomUUID()}`?**
    To namespace files logically by user, guarantee global uniqueness, and prevent directory traversal or name collisions.
11. **What happens if MongoDB save fails after S3 upload succeeds?**
    A catch block executes a compensatory `DeleteObjectCommand` on S3 to remove the orphaned object.
12. **Can a revoked JWT be immediately invalidated in DriveClone?**
    No. JWTs are stateless and remain cryptographically valid until expiration; DriveClone lacks a server-side token blacklist.
13. **Why delete the S3 object before deleting the MongoDB record?**
    A dangling database record pointing to a missing S3 key is easy to detect and clean up, whereas an unreferenced S3 object silently incurs storage costs.
14. **Why is password length validated in `express-validator` rather than just the Mongoose schema?**
    By the time Mongoose executes schema validation, the password has already been converted into a 60-character bcrypt hash.
15. **What is the purpose of `ResponseContentDisposition` in the S3 GetObjectCommand?**
    It instructs the browser to download the object as an attachment using its original filename rather than opening it inline.

---

### 5 Common Misconceptions to Avoid

1. ❌ **"HTTP-only cookies completely solve XSS."**
   *Correction*: HTTP-only cookies only prevent scripts from *reading* the cookie value. If an XSS vulnerability exists, an attacker can still execute arbitrary DOM actions and make authenticated `fetch()` calls.
2. ❌ **"S3 and MongoDB transactions are atomic in DriveClone."**
   *Correction*: There is no distributed transaction spanning MongoDB and AWS S3. DriveClone coordinates the two systems using sequential operations and best-effort cleanup logic.
3. ❌ **"The browser uploads files directly to S3."**
   *Correction*: Files currently travel from the browser through Express memory via Multer before reaching S3. Direct uploads would require presigned PUT URLs, which is a planned future improvement.
4. ❌ **"JWTs encrypt sensitive user data."**
   *Correction*: JWT payloads are Base64URL-encoded, not encrypted. Anyone can decode and inspect the payload claims; the signature only verifies data integrity.
5. ❌ **"Multer's `files: 1` limit prevents users from uploading multiple files."**
   *Correction*: Multer's limit applies strictly to a single HTTP request. DriveClone's frontend loops through staged files and sends them one by one in separate HTTP POST requests.

---

### One-Page Revision Checklist for Interviews

When discussing DriveClone in a technical interview, ensure you can confidently address:

- [ ] **Architecture Overview**: Node.js/Express monolith coordinating MongoDB (metadata) and private AWS S3 (binary storage).
- [ ] **Authentication Flow**: Registration with `express-validator` and `bcrypt.hash(10)`; login issuing a signed JWT stored in an `httpOnly`, `SameSite=lax` cookie.
- [ ] **Upload Pipeline**: Frontend `fetch` + `FormData` → Multer `memoryStorage` (10 MB cap) → AWS SDK v3 `PutObjectCommand` → MongoDB `File.create()` → Compensatory S3 cleanup on error.
- [ ] **Download Pipeline**: `GET /files/:id/download` → IDOR check (`owner: userId`) → AWS SDK v3 `getSignedUrl` with `ResponseContentDisposition` (60s TTL) → HTTP 302 redirect.
- [ ] **Delete Pipeline**: `DELETE /files/:id` → Verification → S3 `DeleteObjectCommand` → MongoDB `file.deleteOne()`.
- [ ] **Authorization & Security**: Dual-key queries (`_id` + `owner`), XSS HTML escaping for filenames, cookie security flags.
- [ ] **Engineering Trade-offs**:
  - Memory storage vs. disk storage vs. presigned PUT URLs.
  - Stateless JWTs vs. stateful sessions with Redis.
  - S3/MongoDB consistency and failure recovery modes.
- [ ] **Future Evolution**: Presigned PUT direct uploads, Redis token blacklisting/rate limiting, file type whitelisting, and S3 multipart uploads.
