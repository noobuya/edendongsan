package com.interior.pro;

import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;

// 웹의 <a download> 방식은 이 앱의 안드로이드 WebView에서는 DownloadManager로 이어지지
// 않거나(경합 없이도), 이어지더라도 "다운로드" 폴더에 남을 뿐 사진 앱(갤러리)에는 뜨지
// 않는다 — 갤러리에 뜨려면 MediaStore에 직접 등록해야 한다. API 29(Android 10)
// 부터는 이 등록에 저장소 권한이 필요 없어(스코프드 스토리지가 앱이 자기가 만든 미디어를
// 등록하는 것은 항상 허용), 매니페스트에 권한을 새로 추가하지 않고도 구현할 수 있다.
@CapacitorPlugin(name = "GallerySaver")
public class GallerySaverPlugin extends Plugin {

    @PluginMethod
    public void saveImage(PluginCall call) {
        String data = call.getString("data");
        String fileName = call.getString("fileName");
        String mimeType = call.getString("mimeType");
        if (mimeType == null) mimeType = "image/png";
        if (data == null || fileName == null) {
            call.reject("data와 fileName이 필요합니다");
            return;
        }

        int comma = data.indexOf(',');
        if (data.startsWith("data:") && comma != -1) {
            data = data.substring(comma + 1);
        }

        // [왜 — 2026-11-26 "시공 전후 영상은 저장은 되는데 카톡·문자로 못 보낸다"]
        // 처음엔 이미지(MediaStore.Images)로만 저장했는데, 영상(mp4)을 거기에 넣으면
        // 카카오톡·문자 앱의 "사진/동영상" 첨부 목록이 영상 칸(MediaStore.Video)에서
        // 찾아서 안 보였다 — mimeType으로 분기해 영상은 반드시 Video 컬렉션에 넣는다.
        boolean isVideo = mimeType.startsWith("video/");
        Uri collection = isVideo ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;

        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            Context context = getContext();

            ContentValues values = new ContentValues();
            if (isVideo) {
                values.put(MediaStore.Video.Media.DISPLAY_NAME, fileName);
                values.put(MediaStore.Video.Media.MIME_TYPE, mimeType);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    values.put(MediaStore.Video.Media.RELATIVE_PATH, "Movies/InteriorPro");
                    values.put(MediaStore.Video.Media.IS_PENDING, 1);
                }
            } else {
                values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
                values.put(MediaStore.Images.Media.MIME_TYPE, mimeType);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    values.put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/InteriorPro");
                    values.put(MediaStore.Images.Media.IS_PENDING, 1);
                }
            }

            Uri itemUri = context.getContentResolver().insert(collection, values);
            if (itemUri == null) {
                call.reject("갤러리에 저장할 위치를 만들지 못했습니다");
                return;
            }

            try (OutputStream out = context.getContentResolver().openOutputStream(itemUri)) {
                if (out == null) {
                    call.reject("파일을 열지 못했습니다");
                    return;
                }
                out.write(bytes);
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues pendingDone = new ContentValues();
                if (isVideo) {
                    pendingDone.put(MediaStore.Video.Media.IS_PENDING, 0);
                } else {
                    pendingDone.put(MediaStore.Images.Media.IS_PENDING, 0);
                }
                context.getContentResolver().update(itemUri, pendingDone, null, null);
            }

            JSObject ret = new JSObject();
            ret.put("uri", itemUri.toString());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("갤러리 저장 실패: " + e.getMessage(), e);
        }
    }
}
