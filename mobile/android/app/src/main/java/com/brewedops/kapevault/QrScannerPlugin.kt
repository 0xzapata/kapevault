package com.brewedops.kapevault

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.util.Size
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.ReaderException
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Reads one QR code with the camera: the PC's "Add a phone" code (purpose "setup") or a site's 2FA
 * code ("totp"). CameraX frames are decoded on the phone by ZXing's core library - no Google Play
 * services, no ML Kit (its logging sends usage data to Google), no network. The camera view is laid
 * over the app in the same FLAG_SECURE window, so it can never be captured, and the app never looks
 * like it left the screen. CAMERA is asked for only when a scan starts, over the camera view that
 * says why. Nothing is saved: frames are dropped as they are read, and the text goes only to the page.
 *
 * Rejections: canceled (Cancel, Back, or leaving the app), denied (no camera permission),
 * unavailable (no camera), failed.
 */
@CapacitorPlugin(name = "QrScanner", permissions = [Permission(strings = [Manifest.permission.CAMERA], alias = "camera")])
class QrScannerPlugin : Plugin() {
    private var call: PluginCall? = null // the scan on screen (main thread only)
    private var view: ScanView? = null
    private var provider: ProcessCameraProvider? = null
    private var frames: ExecutorService? = null
    private val found = AtomicBoolean(false)
    private val back = object : OnBackPressedCallback(false) {
        override fun handleOnBackPressed() = close("canceled")
    }
    private val main get() = activity as MainActivity

    override fun load() {
        activity.onBackPressedDispatcher.addCallback(activity, back)
    }

    @PluginMethod
    fun scan(call: PluginCall) {
        val purpose = call.getString("purpose")
        if (purpose != "setup" && purpose != "totp") return call.reject("Unknown scan.", "failed")
        if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)) return call.reject("This phone has no camera.", "unavailable")
        bridge.executeOnMainThread {
            if (this.call != null) return@executeOnMainThread call.reject("A scan is already open.", "failed")
            this.call = call
            show(purpose)
            if (getPermissionState("camera") == PermissionState.GRANTED) return@executeOnMainThread startCamera()
            // Android's permission dialog pauses the activity; the user has not left the app.
            main.ownDialog = true
            requestPermissionForAlias("camera", call, "cameraAnswered")
        }
    }

    @PermissionCallback
    private fun cameraAnswered(@Suppress("UNUSED_PARAMETER") call: PluginCall) {
        main.ownDialog = false
        if (this.call == null) return // closed meanwhile
        if (getPermissionState("camera") == PermissionState.GRANTED) startCamera() else close("denied")
    }

    // Leaving the app ends the scan. The permission dialog pauses the activity too, and does not.
    override fun handleOnPause() {
        if (!main.ownDialog) close("canceled")
    }

    override fun handleOnDestroy() = close("canceled")

    private fun show(purpose: String) {
        val scan = ScanView(activity, purpose) { close("canceled") }
        activity.addContentView(scan, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        // Added after the window handed out its insets: ask again, or the text sits under the status bar.
        ViewCompat.requestApplyInsets(scan)
        // The page's text field keeps focus under the camera view, and Android puts its keyboard back up
        // over it (after the permission dialog, too); the first Back would then only close the keyboard.
        // The camera view takes the focus, and the keyboard goes.
        scan.isFocusableInTouchMode = true
        scan.requestFocus()
        WindowCompat.getInsetsController(activity.window, scan).hide(WindowInsetsCompat.Type.ime())
        bridge.webView.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        view = scan
        back.isEnabled = true
        found.set(false)
    }

    private fun startCamera() {
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            val scan = view ?: return@addListener
            val cameras = try {
                future.get()
            } catch (e: Exception) {
                return@addListener close("unavailable")
            }
            provider = cameras
            val selector = listOf(CameraSelector.DEFAULT_BACK_CAMERA, CameraSelector.DEFAULT_FRONT_CAMERA)
                .firstOrNull { runCatching { cameras.hasCamera(it) }.getOrDefault(false) } ?: return@addListener close("unavailable")
            val preview = Preview.Builder().build().also { it.setSurfaceProvider(scan.preview.surfaceProvider) }
            val executor = Executors.newSingleThreadExecutor().also { frames = it }
            val analysis = ImageAnalysis.Builder()
                .setResolutionSelector(ResolutionSelector.Builder().setResolutionStrategy(ResolutionStrategy(Size(1280, 720), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER)).build())
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
                .also { it.setAnalyzer(executor, ::decode) }
            try {
                cameras.unbindAll()
                cameras.bindToLifecycle(activity, selector, preview, analysis)
            } catch (e: Exception) {
                close("failed")
            }
        }, context.mainExecutor)
    }

    // A frame's brightness plane is all a QR reader needs. The copy is wiped once read.
    private val reader = QRCodeReader()
    private val hints = mapOf(DecodeHintType.TRY_HARDER to true, DecodeHintType.ALSO_INVERTED to true)

    private fun decode(image: ImageProxy) {
        image.use {
            if (found.get()) return
            val plane = it.planes[0]
            val bytes = ByteArray(plane.buffer.remaining()).also { b -> plane.buffer.get(b) }
            val text = try {
                val source = PlanarYUVLuminanceSource(bytes, plane.rowStride, it.height, 0, 0, it.width, it.height, false)
                reader.decode(BinaryBitmap(HybridBinarizer(source)), hints).text
            } catch (e: ReaderException) {
                null
            } finally {
                reader.reset()
                bytes.fill(0)
            }
            if (text != null && found.compareAndSet(false, true)) bridge.executeOnMainThread { close(null, text) }
        }
    }

    // Main thread. Ends the scan once: the camera off, the view gone, the page answered.
    private fun close(error: String?, text: String? = null) {
        val pending = call ?: return
        call = null
        back.isEnabled = false
        provider?.unbindAll()
        provider = null
        frames?.shutdown()
        frames = null
        view?.let { (it.parent as? ViewGroup)?.removeView(it) }
        view = null
        bridge.webView.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
        when (error) {
            null -> pending.resolve(JSObject().put("text", text))
            "denied" -> pending.reject("Camera permission denied.", error)
            "unavailable" -> pending.reject("No camera available.", error)
            "canceled" -> pending.reject("Scan closed.", error)
            else -> pending.reject("The camera did not start.", error)
        }
    }
}

/** The camera view: the live picture, the frame marks, what to scan and why, and Cancel. */
@SuppressLint("ViewConstructor")
private class ScanView(context: Context, purpose: String, onCancel: () -> Unit) : FrameLayout(context) {
    val preview = PreviewView(context).apply { scaleType = PreviewView.ScaleType.FILL_CENTER }

    init {
        setBackgroundColor(Color.BLACK)
        isClickable = true // nothing reaches the page underneath
        addView(preview)
        addView(FrameMarks(context))
        val text = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            addView(label(if (purpose == "setup") "Scan the code on your PC" else "Scan the site's 2FA code", 20f, Color.WHITE, bold = true))
            addView(label(if (purpose == "setup") "On your PC: Settings > Backup > Add a phone." else "It is on the site's page for turning on two-factor sign-in.", 15f, Color.WHITE))
            addView(label("KAPEVault uses the camera only to read this code, here on the phone. No picture is saved or sent.", 13f, Color.argb(190, 255, 255, 255)))
        }
        addView(text, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT, Gravity.TOP))
        val cancel = Button(context).apply {
            this.text = "Cancel"
            isAllCaps = false
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.TRANSPARENT)
            minHeight = dp(48)
            minWidth = dp(120)
            setOnClickListener { onCancel() }
        }
        addView(cancel, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL))
        // Clear of the status and navigation bars.
        ViewCompat.setOnApplyWindowInsetsListener(this) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            text.setPadding(dp(24), bars.top + dp(24), dp(24), 0)
            (cancel.layoutParams as LayoutParams).bottomMargin = bars.bottom + dp(24)
            cancel.requestLayout()
            insets
        }
    }

    private fun label(value: String, sp: Float, color: Int, bold: Boolean = false) = TextView(context).apply {
        text = value
        gravity = Gravity.CENTER
        setTextColor(color)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
        if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
        setPadding(0, 0, 0, dp(8))
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}

/** The first-run viewfinder's corner marks, around a centred square, with the rest dimmed. */
private class FrameMarks(context: Context) : View(context) {
    private val dim = Paint().apply { color = Color.argb(110, 0, 0, 0) }
    private val mark = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        style = Paint.Style.STROKE
        strokeWidth = 4 * resources.displayMetrics.density
        strokeCap = Paint.Cap.ROUND
    }
    private val path = Path()

    override fun onDraw(canvas: Canvas) {
        val side = minOf(width, height) * 0.7f
        val left = (width - side) / 2
        val top = (height - side) / 2
        canvas.drawRect(0f, 0f, width.toFloat(), top, dim)
        canvas.drawRect(0f, top + side, width.toFloat(), height.toFloat(), dim)
        canvas.drawRect(0f, top, left, top + side, dim)
        canvas.drawRect(left + side, top, width.toFloat(), top + side, dim)
        val arm = side * 0.14f
        path.reset()
        for ((x, y) in listOf(left to top, left + side to top, left to top + side, left + side to top + side)) {
            val dx = if (x == left) arm else -arm
            val dy = if (y == top) arm else -arm
            path.moveTo(x, y + dy)
            path.lineTo(x, y)
            path.lineTo(x + dx, y)
        }
        canvas.drawPath(path, mark)
    }
}
