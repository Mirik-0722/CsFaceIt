package io.csfaceit.backend.clip;

/**
 * Where the files of a clip are kept in storage. Every attempt to record a clip uploads under keys of its own, so a
 * recorder whose claim was taken away can never write the object that the clip's row names: {@code video_key} and
 * {@code thumbnail_key} say which attempt's files are the clip's. Deleting a clip removes the files of every attempt,
 * by name.
 */
public final class ClipFiles {

    private ClipFiles() {
    }

    /** The key of the video that attempt {@code attempt} (counted from 1) of clip {@code clipId} uploads. */
    public static String video(long clipId, int attempt) {
        return "clips/" + clipId + "-" + attempt + ".mp4";
    }

    /** The key of the thumbnail that attempt {@code attempt} (counted from 1) of clip {@code clipId} uploads. */
    public static String thumbnail(long clipId, int attempt) {
        return "clips/" + clipId + "-" + attempt + ".jpg";
    }
}
