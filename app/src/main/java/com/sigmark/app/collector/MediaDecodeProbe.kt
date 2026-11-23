package com.sigmark.app.collector

import android.content.Context
import android.media.MediaCodec
import android.media.MediaCodecList
import android.media.MediaExtractor
import android.media.MediaFormat
import android.os.Build
import android.os.SystemClock
import com.sigmark.app.R
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ensureActive
import kotlin.coroutines.coroutineContext

internal const val mediaFixture = "sigmark-avc/1"
internal enum class DecodeStage(val title: String) {
    SOURCE("读取固定样片"), CONFIGURE("初始化解码器"), DECODE("等待首帧"), DONE("首帧已输出"),
}

internal data class DecodeResult(
    val stage: DecodeStage,
    val declaredDecoders: Int?,
    val codec: String?,
    val hardware: Boolean?,
    val elapsedMs: Long?,
    val detail: String?,
)

// This is an explicit local test. It does not play audio, render a window, or alter a report.
internal suspend fun probeMediaDecode(context: Context): DecodeResult {
    val started = SystemClock.elapsedRealtime()
    var stage = DecodeStage.SOURCE
    var declared: Int? = null
    var codecName: String? = null
    var hardware: Boolean? = null
    var decoder: MediaCodec? = null
    val extractor = MediaExtractor()
    fun result(message: String? = null) =
        DecodeResult(stage, declared, codecName, hardware, SystemClock.elapsedRealtime() - started, message)
    try {
        context.resources.openRawResourceFd(R.raw.sigmark_avc_v1).use {
            extractor.setDataSource(it.fileDescriptor, it.startOffset, it.declaredLength)
        }
        val track = (0 until extractor.trackCount).firstOrNull {
            extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME) == MediaFormat.MIMETYPE_VIDEO_AVC
        } ?: return result("样片没有 AVC 轨道。")
        extractor.selectTrack(track)
        val format = extractor.getTrackFormat(track)
        stage = DecodeStage.CONFIGURE
        declared = runCatching {
            MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.count {
                !it.isEncoder && it.supportedTypes.any { type -> type.equals(MediaFormat.MIMETYPE_VIDEO_AVC, ignoreCase = true) }
            }
        }.getOrNull()
        val codec = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        decoder = codec
        codecName = codec.name
        if (Build.VERSION.SDK_INT >= 29) hardware = codec.codecInfo.isHardwareAccelerated
        codec.configure(format, null, null, 0)
        codec.start()
        stage = DecodeStage.DECODE
        val deadline = SystemClock.elapsedRealtime() + 4_000
        val info = MediaCodec.BufferInfo()
        var inputDone = false
        while (SystemClock.elapsedRealtime() < deadline) {
            coroutineContext.ensureActive()
            if (!inputDone) {
                val index = codec.dequeueInputBuffer(10_000)
                if (index >= 0) {
                    val input = checkNotNull(codec.getInputBuffer(index))
                    input.clear()
                    val n = extractor.readSampleData(input, 0)
                    inputDone = n < 0
                    codec.queueInputBuffer(index, 0, n.coerceAtLeast(0),
                        if (inputDone) 0 else extractor.sampleTime,
                        if (inputDone) MediaCodec.BUFFER_FLAG_END_OF_STREAM else 0)
                    if (!inputDone) extractor.advance()
                }
            }
            val output = codec.dequeueOutputBuffer(info, 10_000)
            if (output >= 0) {
                val frame = info.size > 0 && (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0
                val ended = (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0
                codec.releaseOutputBuffer(output, false)
                if (frame) {
                    stage = DecodeStage.DONE
                    return result()
                }
                if (ended) return result("样片结束前未产生可用视频帧。")
            }
        }
        return result("初始化后等待 4 秒，仍未得到首帧。")
    } catch (error: CancellationException) {
        throw error
    } catch (error: Exception) {
        return result(error.javaClass.simpleName)
    } finally {
        runCatching { decoder?.release() }
        runCatching { extractor.release() }
    }
}
