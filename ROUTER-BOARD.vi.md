# Router Board cho Windows

Thêm/xóa tối đa 12 cấu hình cửa sổ, chọn model và thư mục cho từng cửa sổ, mở/đóng phiên Codex. Mỗi cửa sổ có cổng API riêng; tất cả dùng chung một 9Router và nhóm tài khoản trong Providers.

## Cài một lần

1. Cài Node.js **20.9+** (khuyến nghị LTS), tải repo và giải nén vào thư mục cố định.
2. Bấm đúp **`setup-router-board.cmd`**. Bộ cài chạy npm install, build 9Router, cài Codex nếu thiếu, và tạo shortcut **Javis Router Board** trên Desktop. Cần mạng lúc cài; thông thường không cần quyền Administrator.
3. Lần đầu đặt mật khẩu dashboard. Trong 9Router: **Providers → Codex → Add Connection** cho từng tài khoản ChatGPT. Dùng cửa sổ trình duyệt riêng nếu nó tự chọn lại cùng tài khoản.
4. **Endpoint → API Keys → Create Key**, bật **Require API key**, rồi dán key vào lời nhắc PowerShell. Key chỉ nhập lần đầu, được mã hóa bằng DPAPI của tài khoản Windows hiện tại.
5. Router Board tự mở. **Cập nhật danh sách model** nếu vừa thêm tài khoản. Điền tên cửa sổ, model và thư mục đầy đủ như `C:\Projects\Javis`, bấm **Thêm cửa sổ → Mở cửa sổ Codex**.

## Dùng hằng ngày

- Bấm shortcut **Javis Router Board**, hoặc `router-board.cmd`.
- Model lấy từ `/v1/models` của router, không dùng danh sách cố định. Model có trong danh sách chưa bảo đảm tài khoản còn quota; router vẫn xử lý giới hạn của từng tài khoản.
- Mỗi thẻ có **Lưu thay đổi**, **Mở cửa sổ Codex**, **Đóng cửa sổ**, **Xóa**. Đóng phiên trước khi đổi model hoặc xóa. Nút Đóng dừng shell và tác vụ con của cửa sổ đó; lưu công việc trước.
- Dùng `/status` trong Codex để kiểm tra provider `javis_router`. Cổng mỗi thẻ ghim model đã chọn, kể cả khi client gửi tên khác.
- Các terminal là phiên độc lập. Có thể dùng URL `/v1` trên thẻ trong công cụ khác hoặc ô Custom của Terminal Board, kèm router API key. Board chỉ quản lý việc đóng terminal do nó tự mở.
- Để phân phối nhiều tài khoản, cấu hình **Round Robin** trong provider Codex. Cổng/cửa sổ không cố định với tài khoản; router quyết định tài khoản cho từng yêu cầu.

| Thành phần | Địa chỉ mặc định |
|---|---|
| 9Router / tài khoản | `http://127.0.0.1:20128` |
| Bảng cửa sổ | `http://127.0.0.1:20129` |
| API cửa sổ 1–12 | `http://127.0.0.1:20130/v1` đến `http://127.0.0.1:20141/v1` |

Chỉ cổng của cấu hình đã thêm mới mở. Xóa cấu hình giải phóng cổng để dùng lại. Listener chỉ bind loopback. Giữ hai cửa sổ nền **9Router** và **Router Board** mở khi làm việc.

## Dữ liệu và khắc phục lỗi

- Cấu hình cửa sổ: `%LOCALAPPDATA%\Javis9Router\board.json`. Dữ liệu router mới: `%LOCALAPPDATA%\Javis9Router\data`. Nếu đã có router ở cổng 20128, launcher ghi nhớ chế độ dùng router có sẵn trong `router.mode.txt`; các lần sau anh cần mở router đó trước. Board không tự chuyển sang kho tài khoản mới khi router cũ đã dừng.
- Key mã hóa trong `board.api-key.xml`, mật khẩu khởi tạo mã hóa trong `dashboard.password.xml`, dưới cùng thư mục. Launcher nạp lại mật khẩu mỗi lần khởi động router riêng; mật khẩu đổi trong Settings của dashboard được ưu tiên. Không chia sẻ hai file này hoặc thư mục data chứa token. Đổi key: `router-board.cmd -ResetKey` khi board đã dừng.
- Cổng bị chiếm: đóng ứng dụng dùng cổng hoặc sửa cấu hình. Bộ cài không dừng ứng dụng khác.
- Chưa có model: kiểm tra tài khoản và giới hạn model của key, rồi cập nhật danh sách. Provider Codex có thông báo rủi ro về subscription/OAuth qua proxy; đọc thông báo trước khi kết nối.
- Board dừng thì cổng cửa sổ dừng; terminal đang mở không tự đóng. Đóng và mở lại terminal sau khi khởi động lại board để quản lý được phiên mới; phiên cũ không tự gắn lại.
- Không ghi vào `.codex/config.toml`. Provider chỉ áp dụng cho từng lần gọi Codex, không thay đổi Terminal Board hiện có.

## Kiểm thử

Đặt `JAVIS_ROUTER_API_KEY` qua cách nhập bảo mật của shell rồi `npm run board`. Node trực tiếp hỗ trợ `JAVIS_ROUTER_URL`, `JAVIS_BOARD_PORT`, `JAVIS_FIRST_WINDOW_PORT`; file cấu hình đã lưu phải khớp dải cổng mới.

`npm run test:board` dùng mock router, không cần tài khoản thật. API/cổng chạy được trên Linux để kiểm thử; terminal và DPAPI cần Windows. Smoke test desktop: setup, đăng nhập, mở hai model, thử `/status`, đóng/xóa một cửa sổ, mở lại shortcut và xác nhận cấu hình còn lưu.
