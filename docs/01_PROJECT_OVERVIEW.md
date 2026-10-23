# 01 — Project Overview

## 1. Project Summary

**DriveClone** is a full-stack cloud file storage application that lets authenticated users upload, list, download, and delete personal files. File binary data is stored in a **private AWS S3 bucket**, while file metadata (name, size, MIME type, owner reference) is persisted in **MongoDB**. Authentication uses **bcrypt** password hashing and **JSON Web Tokens** sealed in HTTP-only cookies.

The application is built with **Node.js / Express** on the backend, **EJS** templates with **Tailwind CSS** on the frontend, and vanilla JavaScript for client-side interactions such as drag-and-drop uploads, live search, and a custom delete-confirmation modal.

---

## 2. Problem Statement & Value Proposition

### What problem does it solve?

Storing files on a single server disk is fragile, non-scalable, and tightly coupled to the host. DriveClone decouples file storage from the application server by delegating binary persistence to AWS S3 — a managed, durable object store — while keeping queryable metadata in MongoDB. This gives users:

- **Isolated, authenticated storage:** Each user's files are stored under a unique S3 key prefix (`users/{userId}/`) and can only be accessed by the owner.
- **Secure downloads without exposing S3 credentials:** The server generates short-lived presigned URLs (60-second TTL), redirecting the browser directly to S3 for the actual byte transfer.
- **Atomic-as-possible lifecycle management:** Upload and delete operations coordinate S3 and MongoDB, with explicit cleanup logic if one step fails.

### Why is this more than basic CRUD?

| Dimension | How DriveClone goes beyond CRUD |
|---|---|
| **Authentication** | bcrypt hashing, JWT signing, HTTP-only cookie transport |
| **Authorization** | Every file query includes `owner: req.user.userId`, preventing IDOR |
| **Cloud object storage** | S3 `PutObjectCommand`, `GetObjectCommand` presigning, `DeleteObjectCommand` |
| **Cross-service coordination** | If `File.create()` fails after `uploadFile()`, the orphaned S3 object is cleaned up |
| **Presigned URLs** | Downloads bypass Express memory entirely; the browser fetches directly from S3 |

---

## 3. Requirements

### Functional Requirements (Implemented)

| # | Requirement | Status |
|---|---|---|
| FR-1 | User registration with username, email, password | ✅ Implemented |
| FR-2 | User login with username + password, JWT cookie issuance | ✅ Implemented |
| FR-3 | User logout (cookie cleared) | ✅ Implemented |
| FR-4 | File upload via multipart form (max 10 MB, one file per request) | ✅ Implemented |
| FR-5 | List all files owned by the authenticated user | ✅ Implemented |
| FR-6 | Download a file via presigned S3 URL | ✅ Implemented |
| FR-7 | Delete a file (S3 object + MongoDB document) | ✅ Implemented |
| FR-8 | Dark/light theme toggle with localStorage persistence | ✅ Implemented |
| FR-9 | Client-side file staging, preview, and batch upload via `fetch` | ✅ Implemented |
| FR-10 | Live client-side search filter over loaded files | ✅ Implemented |
| FR-11 | Custom confirmation modal for destructive delete action | ✅ Implemented |
| FR-12 | Authenticated root route: `GET /` redirects logged-in users to `/home` | ✅ Implemented |

### Non-Functional Requirements

| # | Requirement | Current State |
|---|---|---|
| NFR-1 | Passwords never stored in plaintext | ✅ bcrypt with 10 salt rounds |
| NFR-2 | JWT stored in HTTP-only cookie | ✅ `httpOnly: true, sameSite: 'lax'` |
| NFR-3 | S3 bucket is private (no public ACL) | ⚠️ Assumed private — requires bucket policy verification |
| NFR-4 | Presigned download URLs are short-lived | ✅ 60-second expiry |
| NFR-5 | Upload size capped at 10 MB | ✅ Multer `limits.fileSize` |
| NFR-6 | Responsive UI across mobile/tablet/desktop | ✅ Tailwind responsive classes |
| NFR-7 | Rate limiting on auth endpoints | ❌ Not implemented |
| NFR-8 | Automated tests | ❌ Not implemented |
| NFR-9 | CSRF protection | ❌ Not implemented |

---

## 4. Technology Stack

| Layer | Technology | Responsibility |
|---|---|---|
| **Runtime** | Node.js v22 | Event-driven, non-blocking I/O server |
| **Framework** | Express v5 | HTTP routing, middleware pipeline, request/response handling |
| **Templating** | EJS v5 | Server-side HTML rendering |
| **Styling** | Tailwind CSS (CDN) | Utility-first CSS, responsive layout, class-based dark mode |
| **Typography** | Inter (Google Fonts) | Clean sans-serif UI font |
| **Database** | MongoDB via Mongoose v9 | Document storage for user credentials and file metadata |
| **Cloud Storage** | AWS S3 (SDK v3) | Private binary file storage |
| **Presigning** | `@aws-sdk/s3-request-presigner` | Time-limited download URLs |
| **Credentials** | `@aws-sdk/credential-providers` (`fromIni`) | Local AWS profile-based authentication |
| **Upload Parsing** | Multer v2 | In-memory multipart/form-data parsing |
| **Password Hashing** | bcrypt v6 | Salted password hashing (10 rounds) |
| **Token Auth** | jsonwebtoken v9 | JWT signing and verification |
| **Cookies** | cookie-parser v1 | Parse HTTP cookie header into `req.cookies` |
| **Validation** | express-validator v7 | Request body validation for registration/login |
| **Environment** | dotenv v17 | Load `.env` variables into `process.env` |

---

## 5. User Journey

```
1. VISIT /                 → Landing page (or redirect to /home if JWT is valid)
2. GET /user/register      → Registration form
3. POST /user/register     → Create user (bcrypt hash password, save to MongoDB)
4. GET /user/login         → Login form
5. POST /user/login        → Verify credentials → issue JWT cookie → redirect /home
6. GET /home               → Dashboard (auth middleware checks JWT cookie)
7. Drag-and-drop / browse  → Select files client-side
8. fetch POST /files/upload → Multer parses file → buffer uploaded to S3 → metadata saved to MongoDB
9. fetch GET /files         → JSON list of user's files (filtered by owner)
10. GET /files/:id/download → Server generates presigned URL → 302 redirect to S3
11. fetch DELETE /files/:id → S3 object deleted → MongoDB document deleted
12. POST /user/logout       → Cookie cleared → redirect to /user/login
```

---

## 6. Feature Inventory

### Implemented ✅

- User registration with express-validator field validation
- User login with bcrypt password comparison
- JWT-based authentication via HTTP-only cookies
- Authentication middleware protecting `/home`, `/files/*` routes
- File upload through Express + Multer → S3 `PutObjectCommand`
- Unique S3 keys using `crypto.randomUUID()` under `users/{userId}/`
- File listing filtered by authenticated user's ID
- File download via presigned URL with 60-second TTL and `Content-Disposition: attachment`
- File deletion: S3 object removed first, then MongoDB document
- S3 orphan cleanup if MongoDB save fails after successful S3 upload
- Drag-and-drop file staging with visual dropzone feedback
- Client-side batch upload with progress indicator
- Client-side live search filter
- Custom delete confirmation modal (no native `alert`/`confirm`)
- Dark/light mode toggle persisted in `localStorage` with OS preference detection
- Authenticated root route redirect

### Not Implemented / Planned 🔲

- File type validation (MIME or extension whitelist)
- Rate limiting on authentication endpoints
- CSRF token protection
- File sharing or public links
- Folders / nested directory structure
- File renaming or metadata editing
- User profile management or password change
- Email verification
- Pagination for file listings
- Multipart S3 uploads for files > 10 MB
- Automated testing (unit, integration, e2e)
- Production deployment configuration (PM2, Docker, etc.)
- CDN distribution (CloudFront)

---

## 7. Scope, Limitations & Future Improvements

### Current Scope

DriveClone is a portfolio-grade demonstration of full-stack engineering that integrates user authentication, cloud object storage, and database metadata management. It is a working prototype suitable for showcasing in technical interviews.

### Known Limitations

1. **10 MB per-file upload limit** — Files larger than 10 MB are rejected by Multer. The entire file is buffered in server memory before being sent to S3.
2. **No file type validation** — Any file type is accepted; a production system should whitelist allowed MIME types.
3. **No rate limiting** — Authentication endpoints are vulnerable to brute-force attacks.
4. **No CSRF protection** — The `SameSite=lax` cookie attribute mitigates some cross-site scenarios, but a CSRF token is not implemented.
5. **JWT cannot be revoked** — Once issued, a JWT is valid for 24 hours. There is no server-side session store or token blacklist.
6. **No pagination** — All files are returned in a single JSON response. Large file counts could degrade performance.
7. **S3 + MongoDB are not transactionally atomic** — A failure between the two operations can leave inconsistent state, though cleanup logic mitigates the upload case.
8. **AWS credentials loaded from local INI profile** — This works for local development but is not suitable for production deployment (should use IAM roles or environment variables).
9. **Hardcoded S3 region and bucket name** — These are defined as constants in `s3.service.js` rather than loaded from environment variables.

### Future Improvements

- Move S3 region, bucket name, and credentials to environment variables
- Add file type whitelisting
- Implement rate limiting with `express-rate-limit`
- Add CSRF tokens
- Support multipart S3 uploads for large files
- Add pagination to the file list endpoint
- Implement a token blacklist or switch to refresh tokens
- Write automated tests
- Containerize with Docker for consistent deployment
- Add CloudFront for CDN-accelerated downloads

---

## 8. Interview-Ready Project Introduction (45–60 seconds)

> "DriveClone is a full-stack cloud storage application I built with Node.js, Express, MongoDB, and AWS S3. Users register and log in — passwords are hashed with bcrypt, and sessions use JWTs stored in HTTP-only cookies. Once authenticated, users can upload files through a drag-and-drop interface. The files are sent through Express and Multer to a private S3 bucket, while metadata — filename, size, MIME type, and owner reference — is stored in MongoDB. Downloads use presigned S3 URLs with a 60-second TTL, so the browser fetches directly from S3 without the file passing through my server again. Every file query includes the owner's ID, preventing unauthorized access. The delete flow removes the S3 object first, then the database record. I also built a responsive UI with Tailwind CSS, dark mode, live search, and a custom confirmation modal — all without a frontend framework."

---

## 9. Resume Bullet Points

These describe the **actual** current implementation:

- **Designed and built a full-stack cloud storage application** using Node.js, Express, MongoDB, and AWS S3, implementing user authentication with bcrypt and JWT HTTP-only cookies, file upload via Multer with in-memory buffering to private S3 storage, and presigned URL generation for secure, time-limited downloads.

- **Implemented cross-service file lifecycle management** coordinating AWS S3 object operations with MongoDB metadata persistence, including orphan cleanup logic that removes S3 objects if database writes fail, and owner-scoped queries that prevent unauthorized file access.

- **Built a responsive, framework-free frontend** using EJS templates, Tailwind CSS, and vanilla JavaScript featuring drag-and-drop file staging, batch uploads with progress tracking, live client-side search filtering, a custom destructive-action confirmation modal, and a persistent dark/light theme toggle.
