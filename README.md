# ClipLab — Vbee Multi-user Studio

ClipLab chạy Node.js 22 + Vercel. Chức năng hiện tại:

- quay hoặc tải video tư liệu;
- phân tích video bằng Google Gemini;
- viết kịch bản bằng DeepSeek hoặc OpenAI;
- tạo MP3 bằng Vbee AIVoice;
- **Clon giọng Video**: nhận dạng lời thoại/timeline, tái tạo bằng giọng Ibee được cấp rồi thay track tiếng của video ngay trên trình duyệt;
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
- `OPENAI_API_KEY` — dùng cả viết kịch bản và nhận dạng lời thoại cho Clon giọng Video
- `OPENAI_TRANSCRIBE_MODEL=whisper-1`

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


## Module Clon giọng Video

Kiến trúc giữ nguyên static ES modules + Node.js Serverless. Không dùng FFmpeg trên Vercel.

Luồng:
1. Trình duyệt tách audio từ video thành WAV 16 kHz và chia chunk nhỏ.
2. Backend gửi từng chunk tới OpenAI transcription để lấy transcript + timestamp.
3. Người dùng kiểm tra/sửa transcript nhưng timeline được giữ nguyên.
4. Ibee tạo từng câu bằng voice code admin đã cấp. App đo duration và tối đa một lần điều chỉnh speed để cố khớp slot thời gian.
5. Web Audio API dựng WAV mới trên đúng timeline video.
6. Trình duyệt giữ nguyên video nguồn, loại track tiếng cũ và ghép track Ibee mới bằng MediaStream + MediaRecorder.
7. Không gửi video sang dịch vụ lip-sync bên thứ ba; không cần `SYNC_API_KEY` và không phát sinh phí lip-sync.

Giới hạn chất lượng: phiên bản đầu tối ưu cho một người nói chính, tiếng Việt, video tối đa 3 phút, không hát và không hội thoại chồng tiếng. Hình ảnh/khẩu hình video gốc không bị AI chỉnh sửa; độ khớp miệng phụ thuộc việc audio Ibee bám sát timeline lời nguồn. Ibee public API là TTS nên không thể sao chép tuyệt đối đường cong cao độ/biểu cảm của giọng nguồn như một hệ speech-to-speech. Transcript phải được người dùng duyệt trước khi render nếu yêu cầu giữ nguyên 100% nội dung. Bước ghép video chạy theo thời gian thực trên trình duyệt và có thể mã hóa lại file, nên codec/dung lượng có thể thay đổi.


## Chẩn đoán OpenAI API key

Admin có thể vào **Thiết lập** để xem fingerprint an toàn của key OpenAI mà production đang đọc (chỉ prefix loại key + 4 ký tự cuối và độ dài, không trả secret đầy đủ). App tự bỏ khoảng trắng hoặc một cặp dấu nháy vô tình dính khi copy Environment Variable. Sau khi đổi `OPENAI_API_KEY` trên Vercel phải Redeploy để deployment mới nhận giá trị.
