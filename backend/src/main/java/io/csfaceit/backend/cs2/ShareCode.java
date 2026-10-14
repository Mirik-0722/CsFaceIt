package io.csfaceit.backend.cs2;

import java.math.BigInteger;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * The match sharing code of a CS2 matchmaking match ({@code CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx}) and the match id it
 * stands for. This is the decoder the bridge uses ({@code gcbridge/src/sharecode.js}, which calls
 * {@code globaloffensive-sharecode} 1.1.1), ported: the 25 characters without {@code CSGO}, last one first, are the digits
 * of a number in base 57 over the alphabet below, kept to 18 bytes (what does not fit is dropped, as the library drops
 * it); the first 8 of those bytes, read with the lowest byte first, are the match id. The bridge refuses a code with a
 * character outside the alphabet, and so does this.
 *
 * <p>Needed where the bridge does not say the match id: its answer that a replay has expired.
 */
public final class ShareCode {

    /** What a code has to look like before anything else is asked of it. */
    public static final Pattern PATTERN = Pattern.compile("^CSGO(-[A-Za-z0-9]{5}){5}$");

    /** The alphabet of the codes: letters and digits without {@code 0}, {@code 1}, {@code I}, {@code l} and {@code g}. */
    private static final String DICTIONARY = "ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789";

    private static final BigInteger BASE = BigInteger.valueOf(DICTIONARY.length());
    private static final int BYTES = 18;
    private static final BigInteger MODULUS = BigInteger.ONE.shiftLeft(BYTES * 8);

    private ShareCode() {
    }

    /** Whether the text has the shape of a sharing code. */
    public static boolean isWellFormed(String code) {
        return code != null && PATTERN.matcher(code).matches();
    }

    /**
     * The match id the code stands for, as a decimal number (an unsigned 64-bit one).
     *
     * @return empty when the text is not a sharing code: not of its shape, or with a character outside its alphabet
     */
    public static Optional<String> matchId(String code) {
        if (!isWellFormed(code)) {
            return Optional.empty();
        }
        // As the library: every "CSGO" goes, not only the first, so a group that spells it leaves too few characters.
        String characters = code.replace("CSGO", "").replace("-", "");
        if (characters.length() != 25) {
            return Optional.empty();
        }
        BigInteger value = BigInteger.ZERO;
        for (int i = characters.length() - 1; i >= 0; i--) {
            int digit = DICTIONARY.indexOf(characters.charAt(i));
            if (digit < 0) {
                return Optional.empty();
            }
            value = value.multiply(BASE).add(BigInteger.valueOf(digit)).mod(MODULUS);
        }
        byte[] bytes = toFixedBytes(value);
        long matchId = 0;
        for (int i = 7; i >= 0; i--) {
            matchId = (matchId << 8) | (bytes[i] & 0xFF);
        }
        return Optional.of(Long.toUnsignedString(matchId));
    }

    /** The number as exactly {@value #BYTES} bytes, the highest first. */
    private static byte[] toFixedBytes(BigInteger value) {
        byte[] raw = value.toByteArray();
        byte[] bytes = new byte[BYTES];
        int length = Math.min(raw.length, BYTES);
        System.arraycopy(raw, raw.length - length, bytes, BYTES - length, length);
        return bytes;
    }
}
