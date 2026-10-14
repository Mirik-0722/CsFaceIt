package io.csfaceit.backend.cs2;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;

/**
 * Binds the {@code cs2.*} block of {@code application.yml}: linking a player's CS2 matchmaking history and the walk along
 * their match sharing codes ({@link Cs2LinkService}, {@link Cs2ChainJob}). The whole feature is on only while the Steam
 * Web API key, the address of the bridge to the game coordinator and the secret that seals the authentication codes are
 * all set ({@link #enabled}); with any of them empty the endpoints answer 404 {@code CS2_DISABLED} and the job does
 * nothing. What is wrong in a setting that is given (a secret that is not 32 bytes, a bridge without its token, an
 * address that is not http) stops the start with a message that names the variable and never its value; that is
 * checked by the beans that use them ({@link AuthCodeCipher}, {@link BridgeClient}, {@link SteamShareCodeClient}).
 *
 * <p>None of the secrets is ever logged, and {@link #toString} leaves them out.
 *
 * @param steamApiKey the Steam Web API key ({@code STEAM_WEB_API_KEY}); sent to Steam in the query of every call
 * @param steamApiUrl where Steam's Web API is ({@code CS2_STEAM_API_URL}); Steam's own address unless a fake plays it
 * @param steamTimeout how long a call to Steam may take, to connect and to answer
 * @param bridgeUrl the address of the bridge ({@code CS2_BRIDGE_URL}), such as {@code http://gcbridge:8090}
 * @param bridgeToken the secret the bridge wants in {@code X-Bridge-Token} ({@code CS2_BRIDGE_TOKEN}); required as soon
 *        as {@code bridgeUrl} is set
 * @param bridgeTimeout how long a call to the bridge may take; the bridge itself waits up to 15 seconds for the game
 *        coordinator, and a request can also wait in its queue first
 * @param linkSecret the key that seals the authentication codes ({@code CS2_LINK_SECRET}): the base64 of exactly 32
 *        random bytes
 * @param sync the walk along the chains of codes
 */
@Validated
@ConfigurationProperties(prefix = "cs2")
public record Cs2Properties(
        @DefaultValue("") String steamApiKey,
        @DefaultValue("https://api.steampowered.com") String steamApiUrl,
        @DefaultValue("10s") @NotNull Duration steamTimeout,
        @DefaultValue("") String bridgeUrl,
        @DefaultValue("") String bridgeToken,
        @DefaultValue("30s") @NotNull Duration bridgeTimeout,
        @DefaultValue("") String linkSecret,
        @DefaultValue @Valid @NotNull Sync sync) {

    /**
     * The walk along the chains ({@link Cs2ChainJob}).
     *
     * @param interval how often the job runs, counted from the end of the last run
     * @param linksPerRun the most links one run walks
     * @param stepsPerLink the most steps one run takes on one link; a step is the bridge's answer for the code that is
     *        pending (if any) and then one question to Steam for the next code
     * @param idleRecheck when Steam has no newer code, how long until the link is asked again
     * @param notReadyRecheck when the bridge says that the replay of a match is not ready yet, how long until it is asked
     *        again (the bridge says "expired" by itself once the match is two hours old)
     */
    public record Sync(
            @DefaultValue("2m") @NotNull Duration interval,
            @DefaultValue("5") @Min(1) int linksPerRun,
            @DefaultValue("5") @Min(1) int stepsPerLink,
            @DefaultValue("15m") @NotNull Duration idleRecheck,
            @DefaultValue("5m") @NotNull Duration notReadyRecheck) {
    }

    /** Whether the feature is on: the Steam Web API key, the bridge and the secret are all set. */
    public boolean enabled() {
        return isSet(steamApiKey) && isSet(bridgeUrl) && isSet(linkSecret);
    }

    static boolean isSet(String value) {
        return value != null && !value.isBlank();
    }

    @Override
    public String toString() {
        return "Cs2Properties[steamApiKey=" + hidden(steamApiKey) + ", steamApiUrl=" + steamApiUrl
                + ", steamTimeout=" + steamTimeout + ", bridgeUrl=" + bridgeUrl + ", bridgeToken=" + hidden(bridgeToken)
                + ", bridgeTimeout=" + bridgeTimeout + ", linkSecret=" + hidden(linkSecret) + ", sync=" + sync + "]";
    }

    private static String hidden(String secret) {
        return isSet(secret) ? "(set)" : "(not set)";
    }
}
