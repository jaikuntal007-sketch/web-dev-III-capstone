# API Documentation

Base URL: `http://localhost:5000/api`

**Conventions**

- Authenticated routes need the header `Authorization: Bearer <accessToken>`.
- Success: `{ "success": true, "message": "...", "data": ..., "meta": {...} }` (`meta` only on paginated lists: `{ page, limit, total, pages }`).
- Error: `{ "success": false, "message": "...", "errors": [{ "field", "message" }] }` (`errors` only for validation failures).
- Common errors on every protected route: **401** (missing/invalid/expired token), **403** (role not allowed), **400** (malformed id, e.g. `/students/abc`).
- Pagination query params: `page` (default 1), `limit` (default 10, max 100).
- Dates are `YYYY-MM-DD`. Attendance percentage is calculated on the server.

Role abbreviations: **A** = admin, **F** = faculty, **S** = student.

---

## 1. Authentication

### POST `/auth/login`
Log in. **Auth:** none. **Role:** any.
Body: `{ "email": "admin@campus.edu", "password": "Admin@123" }`
Success **200**:
```json
{ "success": true, "message": "Login successful",
  "data": { "user": { "_id": "...", "name": "Dr. Meera Kapoor", "email": "admin@campus.edu", "role": "admin", "department": "Administration" },
            "accessToken": "<jwt>", "refreshToken": "<jwt>" } }
```
Errors: **400** invalid email/missing password; **401** `Invalid email or password`; **403** account deactivated.

### POST `/auth/refresh`
Exchange a refresh token for a new access + refresh token (rotation: the old refresh token stops working). **Auth:** none.
Body: `{ "refreshToken": "<jwt>" }`
Success **200**: `{ "data": { "accessToken": "...", "refreshToken": "..." } }`
Errors: **400** missing token; **401** invalid, expired, already used or logged-out token.

### POST `/auth/logout`
Invalidate the given refresh token. **Auth:** required. **Role:** any.
Body: `{ "refreshToken": "<jwt>" }` → **200** `Logged out successfully`. Errors: 400, 401.

### GET `/auth/me`
Current user profile (no password). **Auth:** required. **Role:** any. → **200** `data: user`. Errors: 401.

### POST `/auth/register`
Administrator-controlled user creation (no public sign-up). **Auth:** required. **Role:** A.
Body: `{ "name", "email", "password" (min 6), "role": "admin|faculty|student", "department", "rollNumber" (required for students), "phone"? }`
Success **201**: `data: user`. Errors: 400 validation, 401, 403, 409 duplicate email/roll number.

---

## 2. Students (admin only) — `/students`

| Method & URL | Purpose | Success |
|---|---|---|
| GET `/students?page&limit&q&department` | List/search/filter students (`q` matches name, email, roll no.) | 200 array + `meta` |
| POST `/students` | Create student | 201 student |
| GET `/students/:id` | Get one | 200 student |
| PUT `/students/:id` | Update (partial; a new `password` is re-hashed) | 200 student |
| DELETE `/students/:id` | Delete; also removes their enrolments and attendance | 200 `data: null` |

**Auth:** required. **Role:** A for all five.
Create body: `{ "name", "email", "password", "rollNumber", "department", "phone"? }`
Update body: any of `name, email, password, rollNumber, department, phone, isActive`.
Example **201**:
```json
{ "success": true, "message": "Student created successfully",
  "data": { "_id": "665f...", "name": "Temp Student", "email": "t@campus.edu", "role": "student", "rollNumber": "TMP001", "department": "Computer Science", "isActive": true, "createdAt": "...", "updatedAt": "..." } }
```
Errors: 400 validation / bad id, 401, 403 (faculty or student), 404 student not found, 409 duplicate email or roll number.

## 3. Faculty (admin only) — `/faculty`

Identical to Students but without `rollNumber`; deleting a faculty member sets `faculty: null` on their courses.
`GET /faculty`, `POST /faculty`, `GET /faculty/:id`, `PUT /faculty/:id`, `DELETE /faculty/:id`. **Role:** A.
Create body: `{ "name", "email", "password", "department", "phone"? }`. Errors: 400, 401, 403, 404, 409.

---

## 4. Courses — `/courses`

| Method & URL | Purpose | Role |
|---|---|---|
| GET `/courses?page&limit&q&faculty` | A: all courses. F: only courses they teach. S: only courses they are enrolled in (class list hidden) | A, F, S |
| POST `/courses` | Create course | A |
| GET `/courses/:id` | Course detail (F only if assigned, S only if enrolled) | A, F, S |
| PUT `/courses/:id` | Update `courseCode`, `courseName`, `description` | A |
| DELETE `/courses/:id` | Delete course plus its attendance and announcements | A |
| PUT `/courses/:id/faculty` | Assign faculty; `facultyId: null` removes | A |
| POST `/courses/:id/enroll` | Enrol students (idempotent) | A |
| DELETE `/courses/:id/enroll/:studentId` | Remove a student | A |
| GET `/courses/:id/students` | Enrolled students | A, F (assigned) |

**Auth:** required on all.
Create body: `{ "courseCode": "CS301", "courseName": "Algorithms", "description"?, "faculty"? }`
Assign body: `{ "facultyId": "<id>" }` · Enrol body: `{ "studentIds": ["<id>", "<id>"] }`
Example GET `/courses` (faculty) **200**:
```json
{ "success": true, "message": "Courses retrieved",
  "data": [ { "_id": "...", "courseCode": "CS101", "courseName": "Data Structures", "faculty": { "_id": "...", "name": "Prof. Rajesh Verma" }, "students": ["..."], "studentCount": 4 } ],
  "meta": { "page": 1, "limit": 10, "total": 2, "pages": 1 } }
```
Errors: 400 (validation, `facultyId` not a faculty member, `studentIds` not all students), 401, 403 (wrong role, course not assigned/enrolled), 404 (course or enrolment not found), 409 duplicate course code.

---

## 5. Attendance — `/attendance`

| Method & URL | Purpose | Role |
|---|---|---|
| POST `/attendance` | Mark attendance for a class (bulk) | F (assigned course) |
| GET `/attendance?course&student&date&from&to&status&page&limit` | List records, scoped by role: A all, F own courses, S only own | A, F, S |
| GET `/attendance/my` | Subject-wise totals and percentage for the logged-in student | S |
| GET `/attendance/sheet?course&date` | Enrolled students + status already recorded for that date | F (assigned) |
| GET `/attendance/:id` | One record (S only own, F only own courses) | A, F, S |
| PUT `/attendance/:id` | Change status | F (assigned) |
| DELETE `/attendance/:id` | Delete record | F (assigned) |

**Auth:** required on all.
Mark body: `{ "courseId": "<id>", "date": "2026-11-10", "records": [ { "studentId": "<id>", "status": "Present" }, { "studentId": "<id>", "status": "Absent" } ] }`
Success **201**: `{ "data": { "count": 2, "date": "2026-11-10", "courseId": "..." } }`. This emits the `attendanceMarked` event (see README).
Update body: `{ "status": "Present" | "Absent" }`.
`GET /attendance/my` **200**:
```json
{ "data": { "courses": [ { "courseId": "...", "courseCode": "CS101", "courseName": "Data Structures", "totalClasses": 9, "classesAttended": 7, "percentage": 77.78 } ],
            "overall": { "totalClasses": 25, "classesAttended": 20, "percentage": 80 } } }
```
Errors: **400** invalid status/date, future date, student not enrolled, duplicate student in request; **401**; **403** (not assigned to that course; student/admin trying to mark; viewing another student's record); **404** record/course not found; **409** `Duplicate attendance: ... already have attendance recorded` (also enforced by a unique index on student + course + date).

---

## 6. Announcements — `/announcements`

| Method & URL | Purpose | Role |
|---|---|---|
| GET `/announcements?page&limit&q&target&course` | Feed relevant to the user (A: all; F: university + own courses; S: university + enrolled courses) | A, F, S |
| POST `/announcements` | Publish. A: `university` or any `course`. F: `course` only, for assigned courses | A, F |
| GET `/announcements/:id` | One announcement (if visible to the user) | A, F, S |
| PUT `/announcements/:id` | Edit `title`/`message` (A any; F own only) | A, F |
| DELETE `/announcements/:id` | Delete (A any; F own only) | A, F |

Create body: `{ "title": "Quiz on Monday", "message": "Chapters 1-3", "target": "course", "course": "<courseId>" }` (`course` omitted when `target` is `university`).
Success **201**: `data` = announcement with `createdBy` (`name`, `role`) and `course` (`courseCode`, `courseName`) populated. Emits `announcementCreated` → Socket.IO `announcement:new`.
Errors: 400 (validation, missing `course` for course target), 401, 403 (student; faculty posting university-wide, to unassigned course, or editing someone else's post; viewing an invisible one), 404.

---

## 7. Reports — `/reports`

| Method & URL | Purpose | Role |
|---|---|---|
| GET `/reports/dashboard` | Real statistics for the logged-in role | A, F, S |
| GET `/reports/attendance/students?course&below` | **Aggregation 1:** attendance % per student per course; `below=75` lists students under 75% | A, F (own courses) |
| GET `/reports/attendance/courses?course` | **Aggregation 2:** per-course sessions, students tracked, average attendance | A, F (own courses) |
| GET `/reports/enrollment` | **Aggregation 3:** enrolment stats via `$facet` (per course, summary, per student department) | A |

Student-wise **200**:
```json
{ "data": [ { "studentId": "...", "studentName": "Aarav Mehta", "rollNumber": "CS2021001", "courseId": "...", "courseCode": "CS101", "courseName": "Data Structures", "totalClasses": 8, "attended": 7, "percentage": 87.5 } ] }
```
Enrolment **200**: `{ "data": { "courses": [ { "courseCode", "courseName", "faculty", "enrolledStudents" } ], "summary": { "totalCourses", "totalEnrolments", "averagePerCourse", "unassignedCourses" }, "byDepartment": [ { "department", "enrolments" } ] } }`
Errors: 401, 403 (student on report routes; faculty requesting a course not assigned to them).

---

## 8. Other

`GET /health` — public, returns `{ "success": true, "message": "API is running" }`.
Any unknown route → **404** `{ "success": false, "message": "Route not found: GET /api/xyz" }`. Malformed JSON body → **400**.
