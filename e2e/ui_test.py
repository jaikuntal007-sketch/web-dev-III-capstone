import datetime, re, sys
from playwright.sync_api import sync_playwright, expect

BASE = "http://localhost:5173"
results, problems = [], []

def check(name, fn):
    try:
        fn(); results.append((name, True, ""))
    except Exception as e:
        results.append((name, False, " | ".join(str(e).splitlines()[:6])[:600])); print("FAIL "+name+" -> "+" | ".join(str(e).splitlines()[:6])[:600], flush=True)

def login(page, email, pw):
    page.goto(BASE + "/login")
    page.fill('input[type=email]', email)
    page.fill('input[type=password]', pw)
    page.click('button[type=submit]')

with sync_playwright() as p:
    b = p.chromium.launch()
    def mk():
        ctx = b.new_context(viewport={"width": 1280, "height": 800})
        ctx.set_default_timeout(6000)
        pg = ctx.new_page()
        pg.on("console", lambda m: problems.append(f"console.{m.type}: {m.text[:160]}") if m.type == "error" else None)
        pg.on("pageerror", lambda e: problems.append(f"pageerror: {str(e)[:160]}"))
        pg.on("response", lambda r: problems.append(f"HTTP {r.status} {r.request.method} {r.url}") if r.status >= 500 else None)
        return pg
    admin, fac, stu = mk(), mk(), mk()

    # ---- login failure + unauthenticated redirect
    def t_redirect():
        admin.goto(BASE + "/admin/students"); expect(admin).to_have_url(re.compile("/login"))
    check("unauthenticated user is redirected to /login", t_redirect)

    def t_bad_login():
        login(admin, "admin@campus.edu", "wrong"); expect(admin.get_by_role("alert")).to_contain_text("Invalid email or password")
    check("bad login shows API error message", t_bad_login)

    # ---- admin
    def t_admin_login():
        login(admin, "admin@campus.edu", "Admin@123"); expect(admin).to_have_url(BASE + "/admin")
        expect(admin.get_by_text("Welcome, Dr. Meera Kapoor")).to_be_visible()
        card = admin.locator("div", has_text="Students").filter(has=admin.locator("p.text-3xl")).first
        expect(admin.locator("p.text-3xl").first).to_have_text("5")  # real student count from MongoDB
        admin.screenshot(path="/home/claude/e2e/admin_dashboard.png")
    check("admin logs in; dashboard shows real counts (5 students)", t_admin_login)

    def t_student_crud():
        admin.click("text=Students >> nth=0"); admin.get_by_role("link", name="Students").click()
        expect(admin.get_by_text("Aarav Mehta")).to_be_visible()
        admin.get_by_placeholder("Search students").fill("diya")
        expect(admin.get_by_text("Diya Patel")).to_be_visible(); expect(admin.get_by_text("Aarav Mehta")).to_have_count(0)
        admin.get_by_placeholder("Search students").fill("")
        admin.get_by_role("button", name="Add student").click()
        m = admin.get_by_role("dialog")
        m.get_by_label("Full name").fill("Test Learner"); m.get_by_label("Email").fill("learner@campus.edu")
        m.get_by_label("Password", exact=True).fill("Learner@123"); m.get_by_label("Roll number").fill("CS2099")
        m.get_by_label("Department").fill("Computer Science"); m.get_by_role("button", name="Save").click()
        expect(admin.get_by_text("Student created successfully")).to_be_visible()
        expect(admin.get_by_role("cell", name="Test Learner")).to_be_visible()
        # duplicate email shows API error inside the form
        admin.get_by_role("button", name="Add student").click(); m = admin.get_by_role("dialog")
        m.get_by_label("Full name").fill("Dup"); m.get_by_label("Email").fill("learner@campus.edu")
        m.get_by_label("Password", exact=True).fill("Learner@123"); m.get_by_label("Roll number").fill("CS2100")
        m.get_by_label("Department").fill("CS"); m.get_by_role("button", name="Save").click()
        expect(m.get_by_role("alert")).to_contain_text("Duplicate"); m.get_by_role("button", name="Cancel").click()
        # edit then delete
        row = admin.get_by_role("row", name=re.compile("Test Learner"))
        row.get_by_role("button", name="Edit").click(); m = admin.get_by_role("dialog")
        m.get_by_label("Department").fill("Physics"); m.get_by_role("button", name="Save").click()
        expect(admin.get_by_role("row", name=re.compile("Test Learner")).get_by_text("Physics")).to_be_visible()
        admin.get_by_role("row", name=re.compile("Test Learner")).get_by_role("button", name="Delete").click()
        admin.get_by_role("dialog").get_by_role("button", name="Delete").click()
        expect(admin.get_by_role("cell", name="Test Learner")).to_have_count(0)
    check("admin: student search/create/duplicate-error/edit/delete via UI", t_student_crud)

    def t_faculty_courses():
        admin.get_by_role("link", name="Faculty").click(); expect(admin.get_by_text("Prof. Rajesh Verma")).to_be_visible()
        admin.get_by_role("link", name="Courses").click(); expect(admin.get_by_role("cell", name="CS101")).to_be_visible()
        admin.get_by_role("button", name="Add course").click(); m = admin.get_by_role("dialog")
        m.get_by_label("Course code").fill("ZZ900"); m.get_by_label("Course name").fill("Temp Course")
        m.get_by_label("Assigned faculty").select_option(label="Prof. Anita Sharma (Mathematics)"); m.get_by_role("button", name="Save").click()
        expect(admin.get_by_role("row", name=re.compile("ZZ900")).get_by_text("Prof. Anita Sharma")).to_be_visible()
    check("admin: faculty list, create course with faculty assignment", t_faculty_courses)

    def t_enrol():
        admin.get_by_role("link", name="Enrolments").click()
        admin.get_by_label("Course").select_option(label=re.compile("ZZ900")) if False else None
        sel = admin.locator("select").first
        expect(sel.locator("option")).to_have_count(5)
        sel.select_option(index=4)
        expect(admin.get_by_text("No students enrolled yet.")).to_be_visible()
        admin.get_by_text("Aarav Mehta").click()
        admin.get_by_role("button", name=re.compile("Enrol selected \\(1\\)")).click()
        expect(admin.get_by_text("1 student(s) enrolled")).to_be_visible()
        admin.get_by_role("row", name=re.compile("Aarav")).get_by_role("button", name="Remove").click()
        admin.get_by_role("dialog").get_by_role("button", name="Remove").click()
        expect(admin.get_by_text("No students enrolled yet.")).to_be_visible()
    check("admin: enrol and remove a student on the new course", t_enrol)

    def t_cleanup_course():
        admin.get_by_role("link", name="Courses").click()
        admin.get_by_role("row", name=re.compile("ZZ900")).get_by_role("button", name="Delete").click()
        admin.get_by_role("dialog").get_by_role("button", name="Delete").click()
        expect(admin.get_by_role("cell", name="ZZ900")).to_have_count(0)
    check("admin: delete course", t_cleanup_course)

    def t_reports():
        admin.get_by_role("link", name="Reports").click()
        expect(admin.get_by_role("cell", name="Aarav Mehta").first).to_be_visible()
        admin.get_by_label("Show only students below 75%").check() if False else admin.get_by_text("Show only students below 75%").click()
        admin.wait_for_timeout(600)
        admin.get_by_role("button", name="Course-wise attendance").click()
        expect(admin.get_by_role("cell", name=re.compile("CS101 - Data Structures"))).to_be_visible()
        admin.get_by_role("button", name="Enrolment statistics").click()
        expect(admin.get_by_text("Total enrolments")).to_be_visible(); expect(admin.get_by_text("Enrolment by course")).to_be_visible()
        admin.screenshot(path="/home/claude/e2e/admin_reports.png")
    check("admin: all three report tabs render aggregation data", t_reports)

    # ---- faculty + student live
    def t_fac_login():
        login(fac, "rajesh.verma@campus.edu", "Faculty@123"); expect(fac).to_have_url(BASE + "/faculty")
        expect(fac.locator("p.text-3xl").first).to_have_text("2")  # CS101 + CS201
    check("faculty logs in; dashboard shows 2 assigned courses", t_fac_login)

    def t_stu_login():
        login(stu, "aarav.mehta@campus.edu", "Student@123"); expect(stu).to_have_url(BASE + "/student")
        stu.screenshot(path="/home/claude/e2e/student_dashboard.png")
    check("student logs in", t_stu_login)

    def t_route_guard():
        stu.goto(BASE + "/admin/students"); expect(stu).to_have_url(BASE + "/student")
    check("student is blocked from admin route (redirected to /student)", t_route_guard)

    def t_mark_attendance_live():
        fac.get_by_role("link", name="Mark Attendance").click()
        # find a date with no attendance: today (seed only covers past weekdays); if weekend still fine for API
        fac.get_by_label("Course").select_option(index=0)
        expect(fac.get_by_text("Aarav Mehta")).to_be_visible()
        fac.get_by_role("group", name="Attendance for Aarav Mehta").get_by_role("button", name="Absent").click()
        fac.get_by_role("button", name="Save attendance").click()
        expect(fac.get_by_text(re.compile("Attendance saved \\(4 new"))).to_be_visible()
        expect(fac.get_by_text("Already recorded").first).to_be_visible()
        # LIVE: student's browser got a socket notification without reloading
        stu.locator('button[aria-label="Notifications"]').wait_for()
        expect(stu.get_by_text(re.compile("Attendance marked for CS101: Absent")).first).to_be_visible(timeout=5000)
        stu.locator('button[aria-label="Notifications"]').click()
        expect(stu.get_by_text("Attendance marked for CS101: Absent").last).to_be_visible()
        stu.screenshot(path="/home/claude/e2e/student_live_notification.png")
        stu.locator('button[aria-label="Notifications"]').click()
    check("faculty marks attendance -> student receives LIVE socket notification", t_mark_attendance_live)

    def t_duplicate_ui():
        fac.reload(); fac.get_by_label("Course").select_option(index=0)
        expect(fac.get_by_text("Already recorded").first).to_be_visible()
        expect(fac.get_by_text("Everything is saved")).to_be_visible()
    check("faculty: re-opening the same date shows saved state (no duplicate path)", t_duplicate_ui)

    def t_records():
        fac.get_by_role("link", name="Attendance Records").click()
        expect(fac.get_by_text("Attendance percentage by student")).to_be_visible()
        expect(fac.get_by_role("cell", name="Absent").first).to_be_visible()
    check("faculty: attendance records + percentage table", t_records)

    def t_fac_announce_live():
        fac.get_by_role("link", name="Announcements").click()
        fac.get_by_role("button", name="New announcement").click(); m = fac.get_by_role("dialog")
        expect(m.get_by_label("Audience")).to_have_count(0)  # faculty cannot pick university-wide
        m.get_by_label("Course").select_option(index=1)
        m.get_by_label("Title").fill("Live test notice"); m.get_by_label("Message").fill("Posted from the end-to-end test")
        m.get_by_role("button", name="Publish").click()
        expect(fac.get_by_text("Announcement published")).to_be_visible()
        expect(stu.get_by_text("New announcement: Live test notice")).to_be_visible(timeout=5000)
    check("faculty publishes course announcement -> enrolled student notified live", t_fac_announce_live)

    def t_admin_announce_live():
        admin.get_by_role("link", name="Announcements").click()
        admin.get_by_role("button", name="New announcement").click(); m = admin.get_by_role("dialog")
        m.get_by_label("Title").fill("University wide notice"); m.get_by_label("Message").fill("Admin broadcast")
        m.get_by_role("button", name="Publish").click()
        expect(admin.get_by_text("Announcement published")).to_be_visible()
        expect(fac.get_by_text("New announcement: University wide notice")).to_be_visible(timeout=5000)
        expect(stu.get_by_text("New announcement: University wide notice")).to_be_visible(timeout=5000)
    check("admin university announcement -> faculty AND student notified live", t_admin_announce_live)

    def t_student_pages():
        stu.get_by_role("link", name="My Attendance").click()
        expect(stu.get_by_text("Subject-wise attendance").first).to_be_visible()
        expect(stu.get_by_role("cell", name=re.compile("CS101 - Data Structures")).first).to_be_visible()
        stu.screenshot(path="/home/claude/e2e/student_attendance.png")
        stu.get_by_role("link", name="My Courses").click(); expect(stu.get_by_text("Prof. Rajesh Verma").first).to_be_visible()
        stu.get_by_role("link", name="Profile").click(); expect(stu.get_by_text("CS2021001")).to_be_visible()
        expect(stu.get_by_text("password", exact=False)).to_have_count(0)
        stu.get_by_role("link", name="Announcements").click(); expect(stu.get_by_text("Live test notice")).to_be_visible()
        expect(stu.get_by_role("button", name="New announcement")).to_have_count(0)
    check("student: attendance, courses, profile (no password), announcements (no create button)", t_student_pages)

    def t_logout():
        stu.get_by_role("button", name="Logout").click(); expect(stu).to_have_url(re.compile("/login"))
        stu.goto(BASE + "/student"); expect(stu).to_have_url(re.compile("/login"))
    check("logout invalidates session and protects routes", t_logout)

    def t_mobile():
        mc = b.new_context(viewport={"width": 390, "height": 800}); mc.set_default_timeout(6000); mp = mc.new_page()
        login(mp, "admin@campus.edu", "Admin@123"); expect(mp.get_by_text("Welcome, Dr. Meera Kapoor")).to_be_visible()
        mp.get_by_role("button", name="Open menu").click(); expect(mp.get_by_role("link", name="Reports")).to_be_visible()
        mp.screenshot(path="/home/claude/e2e/mobile_menu.png")
    check("responsive: mobile menu opens", t_mobile)
    b.close()

for n, ok, msg in results:
    print(("PASS " if ok else "FAIL ") + n + ("" if ok else f"\n     -> {msg}"))
print(f"\n{sum(1 for r in results if r[1])}/{len(results)} UI checks passed")
print("Browser console/page errors & 5xx:", problems if problems else "none")
