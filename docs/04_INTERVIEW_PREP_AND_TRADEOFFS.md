# 04 — Interview Prep and Trade-offs

---

## Part A: Project Explanation

### 1. 30-Second Introduction

> "DriveClone is a cloud storage app I built with Node.js, MongoDB, and AWS S3. Users authenticate with bcrypt-hashed passwords and JWT cookies, then upload files through a drag-and-drop interface. Files are stored in a private S3 bucket, metadata goes to MongoDB, and downloads use presigned URLs so the file bytes never pass through my server on the way out."

### 2. 60-Second Introduction

> "DriveClone is a full-stack cloud file storage application. On the backend, I use Node.js with Express, MongoDB for metadata, and AWS S3 for binary file storage. Authentication uses bcrypt for password hashing and JWTs stored in HTTP-only cookies.
>
> When a user uploads a file, Express and Multer parse the multipart data into an in-memory buffer, which gets sent to a private S3 bucket. The file metadata — name, size, type, and owner reference — is saved in MongoDB. Every query includes the authenticated user's ID, so users can only access their own files.
>
> For downloads, instead of proxying the file through Express, I generate a presigned S3 URL with a 60-second TTL and redirect the browser directly to S3. This keeps the server lightweight.
>
> The frontend is built with EJS templates, Tailwind CSS, and vanilla JavaScript — no React or framework. It has drag-and-drop uploads, live search, a custom delete-confirmation modal, and a persistent dark/light theme toggle."

### 3. Detailed 2-Minute Explanation

> "I built DriveClone to learn how to integrate multiple services — a Node.js server, a MongoDB database, and AWS S3 — into a cohesive application with real authentication and authorization.
>
> **Authentication:** Users register with a username, email, and password. The password is hashed using bcrypt with 10 salt rounds before being stored in MongoDB. On login, I compare the submitted password against the stored hash, and if it matches, I sign a JWT containing the user's ID and store it in an HTTP-only, SameSite=lax cookie. This cookie is automatically sent with every subsequent request.
>
> **Upload Flow:** The frontend uses the Fetch API with FormData to send files as multipart/form-data. Express uses Multer with memory storage to parse the upload into a Buffer (capped at 10 MB). I generate a unique S3 key using `crypto.randomUUID()` under a per-user prefix, upload the buffer to S3 using the AWS SDK v3 PutObjectCommand, then save the metadata in MongoDB. If the MongoDB save fails, I attempt to delete the orphaned S3 object.
>
> **Download Flow:** Instead of reading the file from S3 and piping it through Express, I generate a presigned URL using `getSignedUrl` with a 60-second expiry. Express issues a 302 redirect, and the browser downloads directly from S3. This means my server doesn't need memory or bandwidth for downloads.
>
> **Authorization:** Every file query includes `owner: req.user.userId`. Even if someone guesses a file ID, the query returns nothing unless they own it. This prevents IDOR vulnerabilities.
>
> **Delete Flow:** I delete the S3 object first, then remove the MongoDB document. If the database delete fails after S3 deletion, I have a dangling database record — which is easier to detect and clean up than an orphaned S3 object.
>
> **Frontend:** I chose EJS with Tailwind CSS and vanilla JavaScript to keep things simple. The dashboard has drag-and-drop file staging, a progress bar, live search filtering, and a custom confirmation modal for deletes — no native `alert()` or `confirm()`. I also added a dark/light theme toggle that persists in localStorage and respects the OS preference on first visit.
>
> **What I'd improve:** Move the S3 config to environment variables, add rate limiting on authentication, implement CSRF tokens, add file type validation, and consider presigned PUT URLs so uploads go directly from the browser to S3."

### 4. "What problem does your project solve?"

> "It solves the problem of secure, scalable file storage. Storing files on a local disk ties them to a single server and creates data durability risks. DriveClone decouples storage from the application by putting files in S3 — which provides eleven nines of durability — while keeping searchable metadata in MongoDB. Each user's files are isolated through ownership checks, and downloads use time-limited presigned URLs so I never have to expose long-lived S3 credentials to the client."

### 5. "What is technically interesting about this project?"

> "The most interesting part is coordinating two independent data stores — S3 and MongoDB — without a distributed transaction. When a user uploads a file, I write to S3 first, then to MongoDB. If MongoDB fails, I clean up the S3 object. When deleting, I remove from S3 first, then MongoDB. The ordering matters because each failure mode has different recovery characteristics, and I had to think through which inconsistency is safer to tolerate."

### 6. "What was the most challenging engineering problem?"

> "Handling the consistency gap between S3 and MongoDB. There's no atomic transaction that spans both systems. On upload, if the database write fails after the S3 upload succeeds, I have an orphaned object in S3. I implemented cleanup logic that attempts to delete the orphan, but if the server crashes between the two operations, or if the cleanup itself fails, the orphan persists. I had to reason carefully about the failure ordering — S3 first on both upload and delete — and accept that best-effort cleanup is the practical solution without introducing a message queue or saga pattern."

### 7. "What would you improve if you had another week?"

> "Four things, in priority order: First, move the hardcoded S3 region, bucket name, and AWS profile to environment variables so the deployment is configurable. Second, add rate limiting to the login endpoint to prevent brute-force attacks. Third, implement file type validation — right now any file type is accepted. Fourth, switch to presigned PUT URLs for uploads so files go directly from the browser to S3, eliminating the 10 MB memory buffer in Express."

---

## Part B: Technical Interview Questions

### Node.js and Express

---

**Q1: Why Node.js for this application?**

**Concise answer:** Node.js is well-suited for I/O-heavy applications. DriveClone spends most of its time waiting for MongoDB queries, S3 API calls, and bcrypt hashing — all asynchronous I/O. Node's event loop handles these without blocking, allowing a single process to serve many concurrent requests.

**Deeper reasoning:** Unlike a thread-per-request model (e.g., traditional Java or PHP), Node uses a single-threaded event loop with non-blocking I/O. When an S3 upload is in progress, the event loop is free to handle other incoming requests. This is efficient for workloads dominated by network I/O rather than CPU computation.

**DriveClone detail:** The upload route awaits `uploadFile()` (S3 call), then `File.create()` (MongoDB call). During each `await`, the event loop processes other connections. bcrypt is the exception — it's CPU-intensive — but the `bcrypt` library delegates hashing to a thread pool.

**Limitation:** CPU-intensive tasks (e.g., image processing, video transcoding) would block the event loop. For those, you'd need worker threads or a separate service.

---

**Q2: What happens when an HTTP request reaches Express?**

**Concise answer:** Express processes the request through its middleware stack in the order middleware was registered. Each middleware can modify the request/response, end the request, or call `next()` to pass control to the next middleware. Eventually, a route handler sends a response.

**DriveClone detail:** A request to `POST /files/upload` passes through: `express.json()` → `cookieParser()` → `express.urlencoded()` → route matching → `authMiddleware` (verifies JWT) → `upload.single('file')` (Multer parses multipart) → route handler (S3 upload + DB save).

**Follow-up:** If `authMiddleware` calls `res.redirect('/user/login')` instead of `next()`, the remaining middleware and route handler never execute.

---

**Q3: What is middleware, and why does order matter?**

**Concise answer:** Middleware is a function that intercepts the request before the route handler. Order matters because each middleware relies on modifications made by previous ones. For example, `cookieParser()` must run before `authMiddleware` because `authMiddleware` reads `req.cookies.token`.

**DriveClone example:** If `express.urlencoded()` ran after the login route handler, `req.body` would be `undefined` during login form processing.

---

**Q4: What is the difference between synchronous and asynchronous I/O?**

**Concise answer:** Synchronous I/O blocks the calling thread until the operation completes. Asynchronous I/O initiates the operation and returns immediately, notifying the caller via a callback, Promise, or event when the result is ready.

**DriveClone example:** `await File.find({ owner: userId })` is asynchronous. The MongoDB driver sends the query over the network and returns a Promise. While waiting for the response, Node's event loop handles other requests. If this were synchronous, the entire server would freeze until MongoDB replied.

---

**Q5: How do Promises and async/await work?**

**Concise answer:** A Promise represents a value that will be available in the future. It can be `pending`, `fulfilled`, or `rejected`. `async/await` is syntactic sugar: `await` pauses execution within the `async` function until the Promise settles, making asynchronous code read like synchronous code.

**DriveClone example:**
```javascript
// This:
const result = await response.json();
// Is equivalent to:
response.json().then(result => { /* use result */ });
```

**Trade-off:** `await` makes code readable but can accidentally serialize operations that could run in parallel. DriveClone's batch upload in the frontend uses a sequential `for` loop — each file is uploaded one after another rather than in parallel.

---

**Q6: How should errors be handled in asynchronous routes?**

**Concise answer:** Wrap the route handler body in `try/catch`. Caught errors should return an appropriate HTTP status and JSON message. Distinguish between expected errors (validation, not found) and unexpected errors (database down, S3 unreachable).

**DriveClone implementation:** Every async route handler uses `try/catch`. Specific error types are checked:
```javascript
if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ ... });
if (error.name === 'CastError') return res.status(404).json({ ... });
return res.status(500).json({ message: 'Unable to upload file.' });
```

**Limitation:** DriveClone has no global error handler. An unhandled rejection in middleware could crash the process.

---

**Q7: What is the difference between authentication and authorization?**

**Concise answer:** Authentication verifies identity ("who are you?"). Authorization determines access rights ("what are you allowed to do?").

**DriveClone implementation:** The `authMiddleware` handles authentication by verifying the JWT. Authorization happens in route handlers where file queries include `owner: req.user.userId` — an authenticated user can only access files they own.

---

**Q8: How would you design RESTful file-management endpoints?**

**Concise answer:** Use nouns for resources and HTTP methods for actions:

| Method | Path | Action |
|---|---|---|
| `POST` | `/files` | Upload a file (create) |
| `GET` | `/files` | List all files (read collection) |
| `GET` | `/files/:id` | Get one file's metadata (read item) |
| `GET` | `/files/:id/download` | Download file content |
| `DELETE` | `/files/:id` | Delete a file |

**DriveClone variation:** Uses `/files/upload` for the POST endpoint rather than just `/files`. This is slightly less RESTful but makes the route's purpose explicit.

---

### MongoDB and Mongoose

---

**Q9: Why MongoDB rather than a relational database?**

**Concise answer:** MongoDB's document model maps naturally to the application's data. Files and users are independent entities with a simple one-to-many relationship — no complex joins needed. Mongoose schemas provide enough structure without the rigidity of SQL table migrations.

**Trade-off:** A relational database would provide stronger consistency guarantees (ACID transactions across tables), foreign key constraints, and `JOIN` queries. For DriveClone's scale and complexity, MongoDB is simpler to set up and sufficient.

**When to switch:** If DriveClone needed complex relationships (shared files, folder hierarchies with permissions, audit logs), a relational database would provide better data integrity.

---

**Q10: Why reference a user from a file instead of embedding files in the user document?**

**Concise answer:** Embedding would put all file metadata inside the user document, which grows unboundedly. MongoDB documents have a 16 MB size limit. A user with thousands of files could exceed this limit. Referencing keeps documents small and allows independent querying and indexing of files.

**DriveClone detail:** The `owner` field in the file schema is an ObjectId reference to the user collection. Files are queried with `File.find({ owner: userId })`, which is efficient with an index on `owner`.

---

**Q11: Why use both a file ID and owner ID in a query?**

**Concise answer:** To prevent IDOR (Insecure Direct Object Reference). Querying only by `_id` would allow any authenticated user to access any file if they guessed the ID. Adding `owner: req.user.userId` ensures the file belongs to the requesting user.

```javascript
const file = await File.findOne({ _id: req.params.id, owner: req.user.userId });
// Returns null if the file exists but belongs to a different user
```

---

**Q12: What is `lean()` and when should it be used?**

**Concise answer:** `.lean()` tells Mongoose to return plain JavaScript objects instead of full Mongoose document instances. This is faster and uses less memory. Use it for read-only operations where you don't need to call document methods like `.save()` or `.deleteOne()`.

**DriveClone detail:** The file listing route uses `.lean()` because it only reads data. The delete route does NOT use `.lean()` because it calls `file.deleteOne()` on the document instance.

---

**Q13: How do unique indexes work?**

**Concise answer:** A unique index ensures no two documents in a collection have the same value for the indexed field. In DriveClone, `username` and `email` have `unique: true`, preventing duplicate registrations. `s3Key` also has `unique: true`, preventing duplicate S3 references.

**Caveat:** Unique index violations throw a MongoDB error (code `11000`). DriveClone's registration route catches this as a generic 500 error rather than a specific "username already exists" message. This could be improved.

---

**Q14: What happens when MongoDB saves metadata but S3 operations fail?**

**Concise answer:** This scenario doesn't occur in DriveClone because S3 operations always happen before MongoDB operations. On upload: S3 first, then MongoDB (with cleanup on failure). On delete: S3 delete first, then MongoDB delete. The risk is the reverse — S3 succeeds but MongoDB fails — which triggers the cleanup logic.

---

### Authentication and Web Security

---

**Q15: Explain the registration and login flow.**

**Concise answer:**
- **Register:** Client sends username + email + password → express-validator checks fields → `bcrypt.hash(password, 10)` → `userModel.create()` → 201 response.
- **Login:** Client sends username + password → `findOne({ username })` → `bcrypt.compare()` → `jwt.sign()` → `res.cookie('token', ...)` → 302 redirect to `/home`.

**Key detail:** The password hash is never returned to the client. The registration response includes `id`, `username`, and `email` only.

---

**Q16: Why use bcrypt rather than SHA-256 for passwords?**

**Concise answer:** SHA-256 is a fast hash — an attacker can compute billions per second. bcrypt is deliberately slow, with a configurable work factor. At 10 salt rounds, each hash takes ~100ms. This makes brute-force attacks orders of magnitude slower.

**Technical detail:** bcrypt also generates a random salt per password, so identical passwords produce different hashes. SHA-256 without a salt produces the same hash for the same input, enabling rainbow table attacks.

---

**Q17: Explain JWT structure and signature verification.**

**Concise answer:** A JWT has three parts: header (algorithm), payload (claims like userId, exp), and signature (HMAC-SHA256 of header + payload using the server's secret). On verification, the server recalculates the signature and compares it. If they match, the payload hasn't been tampered with.

**Important nuance:** The payload is Base64URL-encoded, not encrypted. Anyone can decode and read the claims. The signature only proves integrity and authenticity, not confidentiality.

---

**Q18: Why store the JWT in an HTTP-only cookie?**

**Concise answer:** `httpOnly` prevents JavaScript from accessing the cookie via `document.cookie`. This means an XSS attack cannot steal the JWT and send it to an attacker's server. The browser automatically attaches the cookie to every same-origin request.

**Alternative — localStorage:** If the JWT were in localStorage, any XSS vulnerability could read it with `localStorage.getItem('token')`. localStorage tokens also require manual attachment to every `fetch` request via headers.

---

**Q19: Does an HTTP-only cookie completely prevent XSS?**

**Concise answer:** **No.** It prevents XSS from *stealing* the token, but injected JavaScript can still make authenticated requests on behalf of the user (the browser sends the cookie automatically). XSS can also modify the DOM, steal form data, or redirect the user.

**Mitigation:** Sanitize all user-controlled output (DriveClone uses `escapeHtml()` for filenames), use Content-Security-Policy headers, and validate input server-side.

---

**Q20: Does HTTP-only automatically prevent CSRF?**

**Concise answer:** **No.** `httpOnly` has no effect on CSRF. CSRF exploits the fact that the browser automatically sends cookies with cross-origin requests. DriveClone uses `sameSite: 'lax'`, which blocks the cookie on cross-origin POST requests from forms, mitigating most CSRF attacks. However, GET requests with side effects would still be vulnerable.

**Full protection:** Requires CSRF tokens or `sameSite: 'strict'`.

---

**Q21: What is IDOR/BOLA, and how does DriveClone mitigate it?**

**Concise answer:** IDOR (Insecure Direct Object Reference) means an attacker can access another user's data by manipulating an object identifier in the URL (e.g., changing `/files/123` to `/files/456`). DriveClone mitigates this by querying with both the file ID and the authenticated owner ID. If the file doesn't belong to the requester, the query returns null and the server returns 404.

---

**Q22: How would you revoke a JWT before expiration?**

**Concise answer:** JWTs are stateless — the server doesn't track issued tokens. To revoke one, you need server-side state:
1. **Token blacklist:** Store revoked JWTs in Redis. Check the blacklist on every request.
2. **Short-lived access tokens + refresh tokens:** Issue 15-minute access tokens. The refresh token can be revoked server-side.
3. **Change the JWT secret:** Invalidates ALL tokens for ALL users.

**DriveClone limitation:** None of these are implemented. Logout clears the cookie but the JWT remains valid.

---

**Q23: How would you protect login against brute-force?**

**Concise answer:** Rate limiting. Use `express-rate-limit` to limit login attempts per IP (e.g., 10 attempts per 15 minutes). For targeted attacks against specific usernames, implement per-account rate limiting or progressive delays.

**DriveClone status:** Not implemented. This is a known gap.

---

### AWS and File Handling

---

**Q24: Why use S3 instead of local disk?**

**Concise answer:** S3 provides 11 nines of durability, essentially unlimited storage, and managed infrastructure. Local disk ties files to a single server, creates single points of failure, and doesn't scale. S3 also enables presigned URLs for direct browser downloads without proxying through the server.

**Trade-off:** S3 introduces network latency and an external dependency. For a purely local development tool, disk storage would be simpler.

---

**Q25: What is a presigned URL, and why does it expire?**

**Concise answer:** A presigned URL is a self-authenticating URL that grants temporary access to a private S3 object. It contains the AWS signature, the object key, and an expiration timestamp. Anyone who obtains the URL can access the object until it expires.

**Why it expires:** Without expiration, a leaked URL would grant permanent access to the file. DriveClone uses 60-second TTLs, limiting the exposure window. The URL is a **bearer capability** — possession alone grants access.

---

**Q26: Why upload through Express rather than directly to S3?**

**Concise answer:** Uploading through Express allows server-side validation (file size, authentication) before the file reaches S3. Direct browser-to-S3 uploads require generating presigned PUT URLs, which adds complexity and requires trust in the client to respect size limits.

**DriveClone implementation:** Files are sent as `multipart/form-data` to Express, parsed by Multer into an in-memory buffer, then forwarded to S3 via `PutObjectCommand`.

**Trade-off:** This consumes server RAM (up to 10 MB per concurrent upload). For large files or high concurrency, presigned PUT URLs would be better — the file goes directly from the browser to S3, and Express never touches the bytes.

---

**Q27: What happens if a file larger than 10 MB is uploaded?**

**Concise answer:** Multer's `limits.fileSize` rejects the request with an error code `LIMIT_FILE_SIZE`. The route handler catches this and returns a 413 (Payload Too Large) response. The file buffer is discarded.

**Important:** Multer checks the size during parsing, so it aborts before the entire file is buffered if possible. However, with memory storage, partial buffering still occurs.

---

**Q28: How would you support large files?**

**Concise answer:** Use S3 multipart uploads. The file is split into parts (minimum 5 MB each), uploaded independently (potentially in parallel), and then assembled by S3. This supports files up to 5 TB.

For a web application, you would:
1. Generate a presigned URL for each part.
2. The browser uploads parts directly to S3.
3. The server initiates and completes the multipart upload via S3 API calls.

This eliminates server memory pressure entirely.

---

### System Design and Scalability

---

**Q29: What happens when thousands of users upload simultaneously?**

**Concise answer:** With Multer's memory storage and a 10 MB limit, 1000 concurrent uploads would require ~10 GB of RAM — far more than a typical server. The server would crash or refuse connections.

**Solutions:** Switch to presigned PUT URLs (zero server memory per upload), use disk storage (limited by disk I/O), or horizontally scale with a load balancer distributing uploads across multiple server instances.

---

**Q30: How would you scale horizontally?**

**Concise answer:** Run multiple Express instances behind a load balancer (e.g., Nginx, AWS ALB). Since authentication is stateless (JWT in cookies), any instance can handle any request. MongoDB and S3 are already shared services accessible from any instance.

**Caveat:** If you added server-side sessions or a token blacklist, you'd need a shared session store (Redis) accessible from all instances.

---

**Q31: Why might you introduce Redis?**

**Concise answer:** Redis could serve as a JWT token blacklist (for logout/revocation), a session cache, a rate-limit counter store, or a cache for file listings. It's an in-memory key-value store with sub-millisecond latency, making it ideal for data that needs to be shared across horizontally scaled instances.

**DriveClone status:** Redis is not used. This is a potential improvement.

---

**Q32: When would CloudFront be useful?**

**Concise answer:** CloudFront is a CDN that caches S3 objects at edge locations closer to users. It would reduce download latency for geographically distributed users and reduce S3 data transfer costs. It's most beneficial when the same files are downloaded frequently by many users.

**DriveClone status:** Not implemented. Since files are private and per-user, the caching benefit is limited unless files are shared.

---

## Part C: Architectural Trade-offs

### 1. S3 vs. Local Disk Storage

| | S3 | Local Disk |
|---|---|---|
| **Chosen?** | ✅ Yes | |
| **Why it fits** | Managed durability (11 nines), unlimited storage, presigned URLs for direct downloads | |
| **Limitations** | Network latency, AWS dependency, cost per GB/request | |
| **When to switch** | Never for production | Acceptable for a local-only dev prototype |

### 2. MongoDB Metadata vs. Storing Binaries in MongoDB

| | MongoDB Metadata + S3 Binaries | MongoDB GridFS (binaries in DB) |
|---|---|---|
| **Chosen?** | ✅ Yes | |
| **Why it fits** | Keeps database lean; S3 is purpose-built for large objects; enables presigned URLs | |
| **Limitations** | Two systems to coordinate; no atomic transaction | |
| **When to switch** | If you need a single-database deployment without AWS | |

### 3. Express-Mediated Uploads vs. Presigned PUT to S3

| | Express-Mediated | Presigned PUT |
|---|---|---|
| **Chosen?** | ✅ Yes | |
| **Why it fits** | Simple; server validates auth and file size before S3 sees anything | |
| **Limitations** | Server RAM consumed per upload; 10 MB practical limit | |
| **When to switch** | When files exceed 10 MB, or under high concurrency | |

### 4. EJS SSR vs. React with Separate API

| | EJS SSR | React SPA |
|---|---|---|
| **Chosen?** | ✅ Yes | |
| **Why it fits** | No build step; simple for 4 pages; vanilla JS handles interactivity | |
| **Limitations** | No client-side routing; full page reloads; harder to build complex UIs | |
| **When to switch** | If the UI becomes complex (folder trees, drag-to-reorder, real-time collaboration) | |

### 5. JWT Cookies vs. Server-Side Sessions

| | JWT Cookies | Server-Side Sessions |
|---|---|---|
| **Chosen?** | ✅ Yes | |
| **Why it fits** | Stateless; no session store needed; works across horizontal instances | |
| **Limitations** | Cannot revoke a JWT before expiry; payload visible (not encrypted) | |
| **When to switch** | If you need instant revocation or sensitive data in the session | |

### 6. bcrypt vs. SHA-256 for Passwords

| | bcrypt | SHA-256 |
|---|---|---|
| **Chosen?** | ✅ Yes | |
| **Why it fits** | Deliberately slow (configurable work factor); per-password salt; industry standard for password storage | |
| **Limitations** | CPU-intensive (~100ms per hash) | |
| **When to switch** | Never for passwords. SHA-256 is appropriate for checksums or HMAC, not password storage. |

### 7. Memory Storage vs. Disk Storage for Multer

| | Memory Storage | Disk Storage |
|---|---|---|
| **Chosen?** | ✅ Yes | |
| **Why it fits** | Simpler code; no temp file cleanup; fast for small files | |
| **Limitations** | RAM consumption proportional to file size × concurrent uploads | |
| **When to switch** | When file size limits increase or concurrency is high | |

### 8. Presigned URLs vs. Proxying Downloads

| | Presigned URL + Redirect | Express Proxy |
|---|---|---|
| **Chosen?** | ✅ Yes | |
| **Why it fits** | Server uses no memory/bandwidth for downloads; browser fetches directly from S3 | |
| **Limitations** | URL is a bearer token; anyone with it can download within TTL | |
| **When to switch** | If you need to stream-transform content (watermarking, transcoding) or log download progress | |

### 9. Single-Server vs. Horizontal Scaling

| | Single Server | Horizontal Scaling |
|---|---|---|
| **Chosen?** | ✅ Yes | |
| **Why it fits** | Simple deployment; sufficient for a portfolio project | |
| **Limitations** | Single point of failure; limited by one machine's resources | |
| **When to switch** | Any production deployment with uptime requirements | |

---

## Part D: Production-Readiness Review

| # | Area | Status | Notes |
|---|---|---|---|
| 1 | **File ownership authorization** | ✅ Verified | All file queries include `owner: req.user.userId` |
| 2 | **Private bucket configuration** | ⚠️ Assumed | S3 bucket is assumed private; verify with `aws s3api get-bucket-acl` |
| 3 | **IAM least privilege** | ⚠️ Unverified | Verify the `driveclone-local-dev` profile only has `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on the specific bucket |
| 4 | **Secrets management** | ⚠️ Partial | `JWT_SECRET` and `MONGO_URI` are in `.env`; S3 bucket name and region are **hardcoded** in source code |
| 5 | **Cookie + CSRF** | ⚠️ Partial | `httpOnly: true, sameSite: 'lax'` — no CSRF tokens |
| 6 | **Upload size validation** | ✅ Implemented | 10 MB Multer limit |
| 7 | **Upload type validation** | ❌ Missing | Any MIME type is accepted |
| 8 | **Memory consumption** | ⚠️ Risk | 10 MB × N concurrent uploads = N × 10 MB RAM |
| 9 | **MongoDB/S3 consistency** | ⚠️ Best-effort | Cleanup logic exists for upload; no reconciliation for delete failures or crashes |
| 10 | **Error handling** | ⚠️ Partial | Per-route try/catch; no global error handler; no structured logging |
| 11 | **Rate limiting** | ❌ Missing | No protection against brute-force login |
| 12 | **Automated tests** | ❌ Missing | No unit, integration, or e2e tests |
| 13 | **Billing controls** | ⚠️ Unverified | No AWS budget alerts configured (should verify in AWS console) |

### Highest-Priority Fixes Before Public Deployment

1. **Rate limiting** on `/user/login` and `/user/register`.
2. **CSRF tokens** for state-changing POST/DELETE requests.
3. **File type validation** (whitelist of allowed MIME types + magic byte check).
4. **Move S3 config to environment variables**.
5. **Global error handler** to catch unhandled exceptions.
6. **Structured logging** (replace `console.error`).
7. **AWS IAM policy audit** — confirm least-privilege.
8. **AWS billing alarms** to catch unexpected S3 charges.

---

## Part E: Interview Practice

### 10 Rapid-Fire Questions

| # | Question | Short Answer |
|---|---|---|
| 1 | What database does DriveClone use? | MongoDB via Mongoose |
| 2 | Where are files stored? | Private AWS S3 bucket |
| 3 | How are passwords protected? | bcrypt with 10 salt rounds |
| 4 | How does the JWT reach the browser? | HTTP-only cookie |
| 5 | What's the presigned URL TTL? | 60 seconds |
| 6 | What's the max upload size? | 10 MB (Multer limit) |
| 7 | How are downloads served? | 302 redirect to presigned S3 URL |
| 8 | How is IDOR prevented? | File queries include `owner: req.user.userId` |
| 9 | What happens on failed MongoDB save after S3 upload? | Orphaned S3 object is cleaned up (best-effort) |
| 10 | Can you revoke a JWT? | Not currently — no blacklist or refresh tokens |

### 5 Difficult Follow-Up Questions

1. **"You said S3 and MongoDB aren't atomic. What's the worst case?"** — Server crashes between S3 upload completing and MongoDB save. The S3 object exists with no database record. There's no automatic way to find or clean it up without a reconciliation job that lists S3 objects and cross-references the database.

2. **"Your JWT contains the username. What if the user changes their username?"** — The JWT payload would contain the old username until it expires. Since DriveClone doesn't have a username-change feature, this isn't a current issue, but it illustrates why long-lived JWTs can carry stale data.

3. **"What if someone intercepts the presigned URL?"** — They can download the file within 60 seconds. This is by design — presigned URLs are bearer capabilities. The 60-second TTL limits the window. Over HTTPS, interception requires a man-in-the-middle attack.

4. **"Your Multer config says `files: 1` but the frontend sends multiple uploads. How?"** — The frontend sends multiple sequential `fetch` requests, each with one file. Multer processes one file per request. The batch behavior is in the client-side JavaScript loop, not in Multer.

5. **"The `sameSite: 'lax'` cookie is sent on top-level GET navigations. Could an attacker craft a malicious link?"** — Yes, if any GET route had side effects (like deleting data), `lax` wouldn't prevent it. DriveClone's destructive operations use POST and DELETE methods, which `lax` blocks from cross-origin form submissions. The DELETE method is called via `fetch`, which is subject to CORS — and since there's no CORS configuration, cross-origin `fetch` requests would fail.

### Mock Interview Progression

**Basic:**
1. "Tell me about your project." → Use the 60-second introduction.
2. "What tech stack did you use?" → Node/Express, MongoDB/Mongoose, AWS S3, EJS, Tailwind, bcrypt, JWT.
3. "How do you store files?" → Metadata in MongoDB, binary data in private S3 bucket.

**Intermediate:**
4. "Walk me through what happens when a user uploads a file." → Describe the full flow: auth check → Multer parsing → S3 PutObject → MongoDB create → cleanup on failure.
5. "How do you handle authentication?" → bcrypt hash + compare, JWT signing, HTTP-only cookie, auth middleware.
6. "How do you prevent users from accessing each other's files?" → Owner ID in every file query.

**Advanced:**
7. "What happens if S3 upload succeeds but the database write fails?" → Explain the cleanup logic and its limitations.
8. "How would you scale this to handle 10,000 concurrent uploads?" → Presigned PUT URLs, horizontal scaling, load balancer, Redis for shared state.
9. "What security vulnerabilities remain?" → No rate limiting, no CSRF tokens, no file type validation, JWT not revocable.
10. "If you had to redesign the file upload, what would you change?" → Presigned PUT URLs for direct browser-to-S3 uploads, background queue for metadata saving, S3 multipart for large files.

### Common Incorrect Answers and Improvements

| Incorrect Answer | Why It's Wrong | Better Answer |
|---|---|---|
| "HTTP-only cookies prevent XSS." | They prevent token theft via XSS, not XSS itself. Injected scripts can still make requests. | "HTTP-only cookies prevent JavaScript from reading the token, but XSS can still make authenticated requests using the browser's automatic cookie attachment." |
| "S3 and MongoDB use a distributed transaction." | There is no transaction protocol spanning both systems. | "S3 and MongoDB are independent. DriveClone uses ordered operations with cleanup logic — this is best-effort, not atomic." |
| "The file uploads directly from the browser to S3." | Files go through Express + Multer first. | "The file is sent to Express as multipart/form-data, parsed by Multer into memory, then forwarded to S3. The browser never communicates directly with S3." |
| "bcrypt encrypts the password." | Hashing is irreversible; encryption is reversible. | "bcrypt hashes the password with a salt. Hashing is a one-way function — you can't recover the original password from the hash." |
| "The presigned URL is secure because it's generated by the server." | The URL itself IS the credential; anyone with it can download. | "The presigned URL is a bearer capability — possession grants access. Its security comes from the 60-second TTL and HTTPS transport." |

### Final Revision Checklist

Before an interview, verify you can:

- [ ] Deliver the 30-second, 60-second, and 2-minute introductions fluently.
- [ ] Draw the architecture diagram on a whiteboard.
- [ ] Trace the upload flow from browser to S3 to MongoDB.
- [ ] Explain why S3 deletion happens before MongoDB deletion.
- [ ] Explain the difference between `httpOnly` and CSRF protection.
- [ ] Explain why bcrypt, not SHA-256, for passwords.
- [ ] Explain what a presigned URL is and why it expires.
- [ ] Name three things you'd improve and explain why.
- [ ] Explain the trade-off of Multer memory storage.
- [ ] Describe how to scale the application horizontally.
- [ ] Articulate the S3/MongoDB consistency problem honestly.
