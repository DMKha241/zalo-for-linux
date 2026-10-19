# Các tính năng dự án bổ sung mà Zalo gốc không có ✨

[English](../FEATURES.md) | **Tiếng Việt**

Tài liệu này giới thiệu các tính năng được bổ sung trong **Zalo for Linux** mà bản Zalo chính thức không có.

---

## Mở Zalo khi không có internet

Sau khi mở bản này online một lần với phiên đăng nhập được ghi nhớ, bạn có thể
khởi động lại Zalo khi mất mạng để xem tài khoản gần nhất, lịch sử chat, danh bạ
và nhóm đã lưu trên máy. Giao diện hiển thị trạng thái ngoại tuyến. Tin nhắn hoặc
tệp đính kèm chưa từng tải về sẽ không xem được khi offline.

Zalo tự thử xác thực lại ở nền. Khi máy chủ chấp nhận phiên đăng nhập, giao diện
tự tải lại và tiếp tục đồng bộ. Đăng xuất hoặc bị máy chủ từ chối phiên đăng nhập
sẽ xóa bản lưu phiên offline.

## 🙈 Khởi động ẩn xuống khay hệ thống

Khi bạn bật **Settings → Launch Zalo on startup**, Zalo sẽ khởi động ở dạng thu
nhỏ xuống khay hệ thống mỗi lần bạn đăng nhập. File tự khởi động mà Zalo ghi vào
`~/.config/autostart/` sẽ mở ứng dụng kèm cờ `--hidden`. Nếu bạn đã bật tùy chọn
này từ một bản build cũ hơn, hãy tắt đi rồi bật lại để cập nhật file đó.

Bạn cũng có thể tự thêm cờ này khi chạy (`--start-hidden` cũng dùng được):

```bash
/path/to/zalo --hidden
```

Bạn có thể mở lại cửa sổ từ biểu tượng ở khay hệ thống, bằng cách bấm vào một
thông báo, hoặc mở Zalo thêm lần nữa. Nếu hệ thống không có khay hệ thống, cờ này
sẽ bị bỏ qua để bạn không bao giờ bị "mất" cửa sổ.

## ⚙️ Cài đặt nâng cao trên Linux

Mở **Settings → Nâng cao...** để đổi nhạc chuông khi có cuộc gọi đến và nhạc chờ
phát trên máy bạn khi gọi đi. Nhập đường dẫn tuyệt đối hoặc chọn tệp âm thanh,
nghe thử rồi bấm **Lưu**. Nút **Mặc định** khôi phục âm thanh gốc của Zalo.
Cấu hình được giữ sau khi khởi động lại và áp dụng từ lần phát tiếp theo. Nếu tệp
bị mất hoặc không phát được, Zalo sẽ dùng âm thanh mặc định.

Userscript Manager mở trong cùng cửa sổ, có hiệu ứng chuyển màn hình và nút quay
lại Nâng cao. Nội dung đang sửa được giữ lại khi chuyển giữa hai màn hình.

## 🧩 Trình quản lý userscript

Mở **Settings → Nâng cao... → Userscript Manager** để tạo, dán, sửa, nhập, xóa, và bật hoặc
tắt các script chạy bên trong Zalo. Các metadata theo kiểu Tampermonkey như
`@name`, `@description`, `@version`, `@match`, `@include` và `@exclude` đều
được nhận diện. Script nhập vào có thể dùng đuôi `.js` hoặc `.user.js`.

Lớp tương thích hiện cung cấp `GM_info`, `GM_addStyle`, `GM_getValue`,
`GM_setValue`, `GM_deleteValue`, `GM_listValues` và `unsafeWindow`. Các thay
đổi sẽ có hiệu lực từ lần tải lại trang Zalo tiếp theo.

> **Bảo mật:** Userscript chạy với quyền truy cập vào trang Zalo hiện tại và các
> tin nhắn đang hiển thị trên đó. Bạn chỉ nên cài những script có nguồn đáng tin cậy.

## 🌙 Tích hợp ZaDark

Dự án có tích hợp sẵn [ZaDark](https://github.com/quaric/zadark). ZaDark là một tiện ích mở rộng giúp bạn bật Dark Mode, tăng cường quyền riêng tư và có thêm nhiều chức năng khác.

**ZaDark giúp bạn trải nghiệm Zalo 🔒 riêng tư hơn ✨ đậm chất cá nhân hơn.**

### Tính năng

- 🌙 **Dark Mode tối ưu riêng cho Zalo** - Giao diện tối hoàn chỉnh, được thiết kế riêng cho Zalo
- 🆃 **Tùy chỉnh phông chữ và cỡ chữ** - Thay đổi cách hiển thị chữ theo ý thích của bạn
- 🖼️ **Tùy chỉnh hình nền chat** - Đặt hình nền riêng cho từng cuộc trò chuyện
- 🔤 **Dịch tin nhắn nhanh** - Dịch tin nhắn ngay sang ngôn ngữ bạn muốn
- 😊 **Bày tỏ cảm xúc với hơn 80 emoji** - Thêm nhiều lựa chọn biểu tượng cảm xúc cho tin nhắn
- 🔒 **Chống nhìn trộm tin nhắn** - Ngăn người khác lén xem tin nhắn của bạn
- 👁️ **Ẩn trạng thái** - Ẩn trạng thái "đang soạn tin", "đã nhận" và "đã xem" với người khác
- 📱 **Tích hợp sẵn** - Được tích hợp liền mạch ngay trong quá trình build

> **Lưu ý:** ZaDark được phát hành theo giấy phép MPL-2.0 và do [Quaric](https://zadark.com) phát triển. Bước setup sẽ tự động chuẩn bị ZaDark, còn bước build sẽ tích hợp ZaDark một cách liền mạch!
