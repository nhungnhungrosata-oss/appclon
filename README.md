# ClipLab - AI Creator Studio

Ứng dụng giao diện tiếng Việt, chạy trên Node.js 22 và Vercel. Quay/tải tư liệu, phân tích hình ảnh video bằng Google, viết kịch bản với DeepSeek/OpenAI, tạo giọng bằng Fish và chuẩn bị tư liệu cho Fish Creative Lip Sync.

## Triển khai Vercel

Import repository này, chọn nhánh `main`. Các file `package.json`, `api/`, `public/`, `lib/`, `scripts/` phải nằm ngay ở Root Directory của project.

- Framework Preset: **Other**.
- Root Directory: để trống (gốc repository).
- Node.js: **22.x**.
- Install Command: `npm ci --ignore-scripts`.
- Build Command: `npm run build`.
- Output Directory: `public`.

`vercel.json` đã chứa cấu hình build và API. Không chuyển sang một trang HTML tĩnh hoặc bỏ thư mục `api` để che lỗi build.

### Biến môi trường

Đặt các biến trong Vercel Settings > Environment Variables, không đưa key thật vào GitHub:

| Biến | Yêu cầu |
| --- | --- |
| `APP_PASSWORD` | Mật khẩu admin riêng, ít nhất 12 ký tự. |
| `SESSION_SECRET` | Chuỗi ngẫu nhiên riêng, ít nhất 32 ký tự. |
| `FISH_API_KEY` | Cần khi tạo giọng. |
| `GOOGLE_API_KEY` | Cần khi phân tích video. |
| `DEEPSEEK_API_KEY` | Cần khi viết bằng DeepSeek. |
| `OPENAI_API_KEY` | Cần khi viết bằng OpenAI. |

Không cần `FAL_KEY`. Thiếu key AI không làm build thất bại; chức năng tương ứng sẽ báo thiếu cấu hình. Sau khi đổi biến môi trường phải redeploy; chọn đúng Production/Preview tương ứng. Không gửi key hoặc mật khẩu trong issue/log.

Đăng nhập bằng tên `admin` và giá trị `APP_PASSWORD` đã cấu hình. Không có mật khẩu chung hoặc mật khẩu mặc định trong mã nguồn.

## Kiểm tra sau deploy

Mở `/api/index?action=health` trên tên miền đã deploy. Kết quả đúng là HTTP 200 với `{"ok":true,"service":"cliplab"}`. Route này chỉ kiểm tra backend còn chạy, không xác nhận API key/số dư của nhà cung cấp.

Trang chủ phải hiện màn hình đăng nhập, tải được `app.js`, `styles.css`, `media.js`, `fish-handoff.js`. `/api/index?action=session` trả HTTP 401 khi chưa đăng nhập là đúng thiết kế.

## Chạy trên máy

```sh
npm ci --ignore-scripts
npm run setup
npm run dev
```

Lệnh setup tạo cấu hình đăng nhập cục bộ; lưu mật khẩu rồi thêm key vào `.env.local`. File này được bỏ qua bởi Git.

## Kiểm thử

```sh
npm run build
npm test
```

Build kiểm tra file giao diện, cú pháp JavaScript và import backend thật. Bộ 41 kiểm thử bao gồm xác thực, giới hạn body, nhà cung cấp mô phỏng, Fish handoff, tài nguyên frontend và health endpoint. Workflow `Verify deployment` chạy lại trên push/PR. Kiểm thử mô phỏng không thay thế việc kiểm tra Fish/Google/OpenAI/DeepSeek bằng tài khoản thật.

## Lip Sync

Bản này không gọi fal. ClipLab xuất gói tư liệu để mở Fish Creative, rồi nhập video kết quả về thư viện. Chưa có tích hợp API Lip Sync tự động của Fish trong ứng dụng. Ưu đãi tạo giọng không đồng nghĩa Lip Sync miễn phí; kiểm tra credit và điều kiện hiện hành trên Fish trước khi tạo.

Tư liệu lưu cục bộ trong trình duyệt, không tự đồng bộ giữa thiết bị. Chỉ sử dụng hình ảnh/giọng có quyền sử dụng.

## Bản sửa triển khai 19/09/2026

Khôi phục bốn file frontend và bộ test bị thiếu, sửa dấu escape làm hỏng cú pháp trong hai file backend, thêm health check, kiểm tra import API trong build, và loại bỏ bootstrap archive chưa hoàn tất. Giữ nguyên các tính năng v1.1; không đưa bí mật hoặc cơ chế bỏ qua xác thực vào repository.
