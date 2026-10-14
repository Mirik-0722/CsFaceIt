package io.csfaceit.backend.cs2;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Component;

/**
 * Seals and opens the CS2 authentication code of a link ({@code cs2_links.auth_code}). The code lets anyone who has it
 * read the player's matchmaking history from Steam, so it is never stored as it is: AES-256-GCM with the key of
 * {@code CS2_LINK_SECRET}, a random 12-byte nonce for every write, and the row stored as nonce, ciphertext and the
 * 16-byte tag one after the other. The associated data is {@code "cs2-link:" + user id}, so a sealed code copied to the
 * row of another user does not open there.
 *
 * <p>Only the walk ({@link Cs2ChainJob}) and the link request ({@link Cs2LinkService}), to make the Steam call they need,
 * open a code. A code that does not open (the secret was changed, the row was copied or damaged) is
 * {@link Unreadable}, whose message says nothing of the row; the caller puts the link into {@code BAD_AUTH_CODE}.
 *
 * <p>The secret is optional (without it the feature is off), but one that is given has to be the base64 of exactly 32
 * bytes, or the backend does not start; the message names the variable and never the value.
 */
@Component
public class AuthCodeCipher {

    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int KEY_BYTES = 32;
    private static final int NONCE_BYTES = 12;
    private static final int TAG_BITS = 128;
    private static final String ASSOCIATED_DATA_PREFIX = "cs2-link:";

    /** The code of the link cannot be read with the secret the backend has now. Carries no detail on purpose. */
    public static final class Unreadable extends Exception {

        Unreadable() {
            super("The authentication code of the link cannot be opened with the current CS2_LINK_SECRET");
        }
    }

    private final SecretKey key;
    private final SecureRandom random = new SecureRandom();

    public AuthCodeCipher(Cs2Properties properties) {
        this.key = Cs2Properties.isSet(properties.linkSecret()) ? keyOf(properties.linkSecret()) : null;
    }

    /** Whether there is a secret to seal and open codes with. */
    public boolean isConfigured() {
        return key != null;
    }

    /**
     * Seals the authentication code of the user's link.
     *
     * @return nonce, ciphertext and tag, for {@code cs2_links.auth_code}
     */
    public byte[] seal(long userId, String authCode) {
        requireKey();
        byte[] nonce = new byte[NONCE_BYTES];
        random.nextBytes(nonce);
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, nonce));
            cipher.updateAAD(associatedData(userId));
            byte[] sealed = cipher.doFinal(authCode.getBytes(StandardCharsets.UTF_8));
            return ByteBuffer.allocate(NONCE_BYTES + sealed.length).put(nonce).put(sealed).array();
        } catch (GeneralSecurityException e) {
            // Not a matter of the input: the JDK always has AES-GCM. Only the kind of failure goes on.
            throw new IllegalStateException("Could not seal an authentication code: " + e.getClass().getSimpleName());
        }
    }

    /**
     * Opens the sealed authentication code of the user's link.
     *
     * @throws Unreadable the row does not open with the current secret, or is not a sealed code at all
     */
    public String open(long userId, byte[] sealed) throws Unreadable {
        requireKey();
        if (sealed == null || sealed.length <= NONCE_BYTES + TAG_BITS / 8) {
            throw new Unreadable();
        }
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, key,
                    new GCMParameterSpec(TAG_BITS, Arrays.copyOfRange(sealed, 0, NONCE_BYTES)));
            cipher.updateAAD(associatedData(userId));
            byte[] code = cipher.doFinal(sealed, NONCE_BYTES, sealed.length - NONCE_BYTES);
            return new String(code, StandardCharsets.UTF_8);
        } catch (GeneralSecurityException | IllegalArgumentException e) {
            throw new Unreadable();
        }
    }

    private void requireKey() {
        if (key == null) {
            throw new IllegalStateException("CS2_LINK_SECRET is not set");
        }
    }

    private static byte[] associatedData(long userId) {
        return (ASSOCIATED_DATA_PREFIX + userId).getBytes(StandardCharsets.UTF_8);
    }

    /** The key of the secret; a secret of another shape stops the start, with a message that holds no part of it. */
    private static SecretKey keyOf(String secret) {
        byte[] bytes;
        try {
            bytes = Base64.getDecoder().decode(secret.trim());
        } catch (IllegalArgumentException e) {
            bytes = new byte[0];
        }
        if (bytes.length != KEY_BYTES) {
            throw new IllegalStateException("CS2_LINK_SECRET must be the base64 of exactly 32 random bytes, for example "
                    + "the output of `openssl rand -base64 32`; leave it empty to switch CS2 matchmaking off");
        }
        return new SecretKeySpec(bytes, "AES");
    }
}
