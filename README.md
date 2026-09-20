# ClipLab — Vbee Multi-user Studio

ClipLab chạy Node.js 22 + Vercel. Chức năng hiện tại:

- quay hoặc tải video tư liệu;
- phân tích video bằng Google Gemini;
- viết kịch bản bằng DeepSeek hoặc OpenAI;
- tạo MP3 bằng Vbee AIVoice;
- admin quản lý danh sách giọng **Nhân bản chuyên nghiệp** và gán giọng cho từng tài khoản con.

Fish Voice và Fish Lip Sync đã được gỡ khỏi ứng dụng.

## Tài khoản

Admin đăng nhập bằng `admin` + `APP_PASSWORD` trên Vercel.

Repo có sẵn 10 tài khoản con `user01` đến `user10`. Chỉ password hash được commit; mật khẩu gốc được bàn giao riêng cho chủ dự án.

Tài khoản con không được nhập hoặc tự thay đổi Vbee voice code. Mỗi tài khoản chỉ nhận giọng admin gán.

## Biến môi trường Vercel

Bắt buộc cho đăng nhập:

- `APP_PASSWORD` — tối thiểu 12 ký tự.
- `SESSION_SECRET` — tối thiểu 32 ký tự.

Vbee:

- `VBEE_APP_ID`
- `VBEE_TOKEN` — token API tạo cùng App ID trên Vbee. App vẫn đọc `VBEE_ACCESS_TOKEN` cũ nếu anh chưa đổi biến ngay.

Các AI khác:

- `GOOGLE_API_KEY`
- `DEEPSEEK_API_KEY`
- `OPENAI_API_KEY`

Đa tài khoản cần Upstash Redis:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Redis được dùng để lưu danh sách voice code và phân quyền giọng theo tài khoản, đồng thời chia sẻ quota giữa các Vercel Functions.

## Giọng Nhân bản chuyên nghiệp Vbee

ClipLab không tạo/clone giọng. Hãy tạo giọng Nhân bản chuyên nghiệp trong tài khoản Vbee trước. Sau đó admin vào **Thiết lập → Quản trị**, nhập tên hiển thị và voice code đã copy từ Vbee, rồi gán cho từng tài khoản.

Ứng dụng đánh dấu danh sách do admin nhập là `professional_clone`. Vì API key thật không nằm trong CI, build không thể tự xác minh cấp độ của voice code; admin phải chỉ thêm đúng giọng Nhân bản chuyên nghiệp mà tài khoản Vbee có quyền sử dụng.

## Deploy

Vercel:
- Framework Preset: Other
- Node.js: 22.x
- Install: `npm ci --ignore-scripts`
- Build: `npm run build`
- Output: `public`

Sau khi đổi Environment Variables phải Redeploy.

Health check: `/api/index?action=health` phải trả HTTP 200 và `{"ok":true,"service":"cliplab"}`.

## Test

```sh
npm ci --ignore-scripts
npm run build
npm test
```

CI không gọi API Vbee/Google/OpenAI/DeepSeek thật nên không phát sinh phí.
