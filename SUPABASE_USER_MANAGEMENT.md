# Quản lý người dùng bằng Supabase — Áp dụng cho Positions Dashboard

Tài liệu này chuyển thể mô hình trong USER_MANAGEMENT.md (StaffBoard) sang đúng
dashboard vị trí của Alma. Điểm khác biệt quan trọng nhất: dữ liệu vị trí
(Ausbildung, §18b/19c/16d) vẫn nằm tĩnh trong các file index.html như hiện tại,
Supabase ở đây **chỉ phụ trách đăng nhập và danh sách đối tác**, không lưu bất
kỳ dữ liệu vị trí nào. Vì vậy không cần bảng dữ liệu nghiệp vụ, không cần liên
kết tài khoản với bản ghi nào cả, mọi đối tác đăng nhập đều xem chung một nội
dung, đúng như bạn đã yêu cầu trước đó.

Việc này thay thế hoàn toàn phần đăng nhập bằng Netlify Identity đã làm trước
đó. Sau khi hoàn tất theo tài liệu này, không cần bật Identity trên Netlify
nữa.

---

## 1. Mô hình hoạt động

1. **Supabase Auth quản lý tài khoản đăng nhập** (email + mật khẩu). Bạn không
   tự lưu mật khẩu của ai cả.
2. **Bảng `profiles`** lưu vai trò của từng tài khoản: `admin` (bạn) hoặc
   `user` (đối tác). Không có liên kết nào khác vì mọi đối tác xem chung một
   nội dung.
3. **Row Level Security (RLS)** đảm bảo chỉ admin mới sửa được vai trò người
   khác, tự động ở tầng cơ sở dữ liệu, không phụ thuộc vào giao diện.
4. **Một Edge Function** (`admin-users`) là nơi duy nhất được phép mời, xoá,
   đổi vai trò tài khoản, vì nó cần một khoá bí mật (service-role key) không
   bao giờ được đưa lên trình duyệt.

```
Trình duyệt (khoá anon, JWT của người dùng)
   │  đọc vai trò của chính mình ──────► Postgres (RLS kiểm tra)
   │  thao tác quản trị (mời, xoá) ────► Edge Function (khoá service-role)
                                            ▲ luôn kiểm tra người gọi là admin trước
```

---

## 2. Thiết lập cơ sở dữ liệu

Tạo dự án tại supabase.com (miễn phí), sau đó vào mục SQL Editor, dán và chạy
đoạn sau:

```sql
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  role         text not null default 'user' check (role in ('admin','user')),
  full_name    text not null default '',
  company_name text not null default '',
  created_at   timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), 'user')
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;

drop policy if exists profiles_read_self_or_admin on public.profiles;
create policy profiles_read_self_or_admin on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
```

Không cần bảng nào khác, vì không có dữ liệu nghiệp vụ nào lưu trong Supabase.

### Tạo tài khoản admin đầu tiên (chính bạn)

1. Vào Authentication > Add user, nhập email và mật khẩu của bạn, tick Auto
   Confirm.
2. Chạy trong SQL Editor:

```sql
update public.profiles
set role = 'admin', full_name = 'Tien'
where id = (select id from auth.users where email = 'ban@almarecruiting.com');
```

---

## 3. Edge Function quản trị đối tác (`admin-users`)

Vào mục Edge Functions trong Supabase, tạo function tên `admin-users`, dán nội
dung sau:

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST")   return json({ error: "Method not allowed" }, 405);

  const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  if (!token) return json({ error: "Missing auth token" }, 401);
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userErr } = await caller.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Invalid session" }, 401);

  const { data: prof } = await caller
    .from("profiles").select("role").eq("id", userData.user.id).single();
  if (!prof || prof.role !== "admin") return json({ error: "Admins only" }, 403);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const body = await req.json().catch(() => ({}));
  const action = body.action as string;

  try {
    if (action === "list") {
      const { data: list, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
      if (error) throw error;
      const { data: profiles } = await admin
        .from("profiles").select("id, role, full_name, company_name");
      const byId = new Map((profiles || []).map((p) => [p.id, p]));
      const users = list.users.map((u) => {
        const p: any = byId.get(u.id) || {};
        return {
          id: u.id, email: u.email, created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at,
          role: p.role || "user", full_name: p.full_name || "",
          company_name: p.company_name || "",
        };
      });
      return json({ users });
    }

    // Mời một đối tác mới bằng email. Họ nhận một email duy nhất từ Supabase,
    // bấm vào là vào thẳng màn hình đặt mật khẩu, không có bước xác nhận
    // riêng nào khác — giống đúng cách bạn đã yêu cầu ở phần Netlify Identity.
    if (action === "invite") {
      const email = String(body.email || "").trim();
      const full_name = String(body.full_name || "");
      const company_name = String(body.company_name || "");
      if (!email) return json({ error: "Thiếu email" }, 400);
      const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { full_name },
      });
      if (error) throw error;
      const { error: upErr } = await admin.from("profiles")
        .upsert({ id: invited.user.id, role: "user", full_name, company_name }, { onConflict: "id" });
      if (upErr) throw upErr;
      return json({ id: invited.user.id, email });
    }

    if (action === "update") {
      const id = String(body.id || "");
      if (!id) return json({ error: "Thiếu id người dùng" }, 400);
      const patch: Record<string, unknown> = {};
      if (body.role !== undefined)         patch.role = body.role === "admin" ? "admin" : "user";
      if (body.full_name !== undefined)    patch.full_name = String(body.full_name || "");
      if (body.company_name !== undefined) patch.company_name = String(body.company_name || "");
      const { error } = await admin.from("profiles").update(patch).eq("id", id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "delete") {
      const id = String(body.id || "");
      if (!id) return json({ error: "Thiếu id người dùng" }, 400);
      if (id === userData.user.id) return json({ error: "Không thể tự xoá chính mình" }, 400);
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "Hành động không hợp lệ" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || "Thao tác thất bại" }, 400);
  }
});
```

Bạn không tự đặt khoá service-role, Supabase tự cấp vào biến môi trường của
function.

---

## 4. Phía trang web (đã có sẵn trong gói file lần này)

Ba file mới đã thay thế cho phần Netlify Identity trước đó:

| File | Vai trò |
|---|---|
| config.js | Chứa địa chỉ dự án Supabase và anon key, bạn cần điền vào |
| auth-gate.js | Lớp đăng nhập, đã viết lại để dùng Supabase thay vì Netlify Identity, vẫn giữ nguyên giao diện đã thiết kế trước đó |
| admin/index.html | Trang quản lý đối tác, chỉ admin mới vào được, để mời, xoá, đổi vai trò |

Bạn cần điền đúng hai giá trị vào config.js, lấy từ Supabase, mục Project
Settings > API:

```js
window.SB_CONFIG = { url: "https://<mã-dự-án>.supabase.co", anonKey: "<anon-key>" };
```

---

## 5. Danh sách việc cần làm theo thứ tự

1. Tạo dự án tại supabase.com.
2. Chạy đoạn SQL ở mục 2 trong SQL Editor.
3. Tạo Edge Function admin-users, dán nội dung ở mục 3, bấm Deploy.
4. Tạo tài khoản của bạn trong Authentication, tick Auto Confirm, rồi chạy
   lệnh SQL để tự phong admin cho tài khoản đó.
5. Điền URL và anon key vào config.js.
6. Vào Supabase, mục Authentication > URL Configuration, đặt Site URL là địa
   chỉ trang đang chạy trên Netlify, ví dụ https://positions.almarecruiting.com,
   và thêm cùng địa chỉ kèm /** vào Redirect URLs. Bỏ qua bước này thì email
   mời và đặt lại mật khẩu sẽ trỏ nhầm về localhost.
7. Tải toàn bộ thư mục lên Netlify hoặc kho GitHub như các lần trước, lần này
   có thêm config.js và admin/index.html.
8. Đăng nhập bằng tài khoản admin của bạn, vào đường dẫn /admin/, mời từng đối
   tác bằng email.

---

## 6. Vài điều cần nhớ

- Anon key được phép để công khai trong mã nguồn, nhưng service-role key thì
  tuyệt đối không, nó chỉ nằm trong Edge Function.
- RLS mới là lớp bảo vệ thật sự, phần kiểm tra ở giao diện chỉ để trải nghiệm
  mượt hơn.
- Nếu quên đặt Site URL và Redirect URLs ở bước 6, email mời sẽ đưa đối tác về
  localhost thay vì trang thật của bạn.
- Xoá một tài khoản Supabase sẽ tự xoá luôn dòng tương ứng trong bảng profiles.
