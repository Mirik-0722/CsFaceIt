package io.csfaceit.backend.demo;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.UnknownHostException;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Decides whether the server may connect to an address that came from a player: the demo link they pasted, and every
 * address a redirect of it leads to. The server fetches that address itself, so without these rules a player could make
 * it ask anything it reaches (the database, the broker, a cloud's metadata service) and learn from the answer. An
 * address passes three steps, all before a connection is made:
 *
 * <ol>
 *   <li><b>Shape.</b> {@code http} or {@code https}; no user name or password; a host that is a plain ASCII host name,
 *       never an IP address in any of its spellings.</li>
 *   <li><b>Allow-list.</b> The scheme, the host and the port are one of {@code demo.link.allowed-origins}: an exact host,
 *       or {@code *.} and a domain for any name under it. A port that is not written is the scheme's own.</li>
 *   <li><b>Addresses.</b> Every address the name resolves to is public: loopback, any-local, link-local (which holds
 *       the cloud metadata address 169.254.169.254), site-local, multicast, 0.0.0.0/8, 100.64.0.0/10, 192.0.0.0/24,
 *       198.18.0.0/15, 240.0.0.0/4, fc00::/7 and 64:ff9b::/96 are refused, also inside an IPv6 address that carries an
 *       IPv4 one (mapped, compatible, 6to4). One such address refuses the name, because the connection could go to
 *       any of them. Only the names of {@code demo.link.private-hosts} skip this step (the fake FACEIT of the
 *       development stack lives on a private network); the list is empty by default, and a WARN says so at startup
 *       when it is not.</li>
 * </ol>
 *
 * <p>The addresses that were checked are handed back ({@link CheckedHop#addresses()}): the download connects to those
 * and does not look the name up again, so a name cannot resolve to a public address for the check and to a private one
 * for the connection.
 */
@Component
public class LinkGuard {

    private static final Logger log = LoggerFactory.getLogger(LinkGuard.class);

    /** Longer than any download link FACEIT or a storage service gives, signature included. */
    static final int MAX_LINK_LENGTH = 2048;

    private static final String LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
    private static final Pattern HOST_NAME = Pattern.compile(LABEL + "(?:\\." + LABEL + ")*");

    /** A label that an IPv4 parser reads as a number: decimal, octal or hexadecimal. */
    private static final Pattern NUMERIC_LABEL = Pattern.compile("[0-9]+|0x[0-9a-f]*");

    private static final Pattern ORIGIN = Pattern.compile("(https?)://([^/:?#@\\s]+)(?::([0-9]{1,5}))?/?");

    private final List<AllowedOrigin> allowed;
    private final Set<String> privateHosts;

    public LinkGuard(DemoLinkProperties properties) {
        this.allowed = properties.allowedOrigins().stream()
                .map(String::trim)
                .filter(entry -> !entry.isEmpty())
                .map(LinkGuard::parseOrigin)
                .toList();
        Set<String> hosts = new LinkedHashSet<>();
        for (String host : properties.privateHosts()) {
            String name = host.trim().toLowerCase(Locale.ROOT);
            if (!name.isEmpty()) {
                if (!HOST_NAME.matcher(name).matches()) {
                    throw new IllegalStateException("demo.link.private-hosts: not a host name: " + name);
                }
                hosts.add(name);
            }
        }
        this.privateHosts = Set.copyOf(hosts);
        if (allowed.isEmpty()) {
            log.info("demo.link.allowed-origins is empty: every pasted demo link is refused");
        }
        if (!privateHosts.isEmpty()) {
            log.warn("demo.link.private-hosts is set ({}): demo links to these hosts may reach private addresses. "
                    + "This is for the development stack with the fake FACEIT only, never for a server.", privateHosts);
        }
    }

    /** One address that passed all three steps, and the addresses its host resolved to, which the download uses. */
    public record CheckedHop(URI uri, String host, int port, List<InetAddress> addresses) {
    }

    /** An entry of the allow-list: an exact host, or ({@code wildcard}) any name that ends with {@code .host}. */
    private record AllowedOrigin(String scheme, String host, boolean wildcard, int port) {

        boolean matches(String scheme, String host, int port) {
            if (!this.scheme.equals(scheme) || this.port != port) {
                return false;
            }
            return wildcard ? host.endsWith("." + this.host) : host.equals(this.host);
        }
    }

    /**
     * Reads the text a player pasted as an address. Only the shape of the text is looked at here; {@link #check} does
     * the rest.
     *
     * @throws DemoLinkRefusedException {@code DEMO_LINK_INVALID}: empty, too long, or not an address
     */
    public URI parse(String text) {
        if (text == null || text.isBlank()) {
            throw DemoLinkRefusedException.invalid("it is empty");
        }
        String trimmed = text.trim();
        if (trimmed.length() > MAX_LINK_LENGTH) {
            throw DemoLinkRefusedException.invalid("it is longer than " + MAX_LINK_LENGTH + " characters");
        }
        try {
            return new URI(trimmed);
        } catch (URISyntaxException e) {
            throw DemoLinkRefusedException.invalid("it is not a well-formed address");
        }
    }

    /**
     * Runs the three steps on one address: the pasted link, or the target of a redirect.
     *
     * @throws DemoLinkRefusedException {@code DEMO_LINK_INVALID} (step 1) or {@code DEMO_LINK_HOST_NOT_ALLOWED} (steps
     *         2 and 3)
     * @throws UnknownHostException the host does not resolve; whether that is final is the caller's to say
     */
    public CheckedHop check(URI uri) throws UnknownHostException {
        String scheme = scheme(uri);
        String host = host(uri);
        int port = port(uri, scheme);
        if (allowed.stream().noneMatch(origin -> origin.matches(scheme, host, port))) {
            throw DemoLinkRefusedException.hostNotAllowed(host, "is not one of the hosts demos are downloaded from");
        }
        InetAddress[] resolved = InetAddress.getAllByName(host);
        if (!privateHosts.contains(host)) {
            for (InetAddress address : resolved) {
                if (!isPublic(address)) {
                    throw DemoLinkRefusedException.hostNotAllowed(host, "resolves to an address that is not public");
                }
            }
        }
        return new CheckedHop(uri, host, port, List.of(resolved));
    }

    private static String scheme(URI uri) {
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (uri.isOpaque() || !(scheme.equals("http") || scheme.equals("https"))) {
            throw DemoLinkRefusedException.invalid("it is not an http or https address");
        }
        return scheme;
    }

    /** The host of the address in lower case, once it is known to be a host name and no IP address. */
    private static String host(URI uri) {
        String authority = uri.getRawAuthority();
        if (uri.getRawUserInfo() != null || (authority != null && authority.contains("@"))) {
            throw DemoLinkRefusedException.invalid("it carries a user name or a password");
        }
        String host = uri.getHost();
        if (host == null || host.isEmpty()) {
            // java.net.URI has no host for an authority it cannot read as host and port: a name with characters
            // outside ASCII letters, digits, dots and hyphens, for example.
            throw DemoLinkRefusedException.invalid("it has no plain ASCII host name");
        }
        host = host.toLowerCase(Locale.ROOT);
        if (host.startsWith("[") || host.contains(":") || isNumeric(host)) {
            throw DemoLinkRefusedException.invalid("it names an IP address instead of a host name");
        }
        if (host.length() > 253 || !HOST_NAME.matcher(host).matches()) {
            throw DemoLinkRefusedException.invalid("it has no plain ASCII host name");
        }
        return host;
    }

    private static int port(URI uri, String scheme) {
        int port = uri.getPort();
        if (port == -1) {
            return scheme.equals("https") ? 443 : 80;
        }
        if (port < 1 || port > 65535) {
            throw DemoLinkRefusedException.invalid("its port is out of range");
        }
        return port;
    }

    /**
     * Whether a host is an IPv4 address in one of the spellings a resolver accepts: the last label is a number (no top
     * level domain is), or every label is a decimal, octal or hexadecimal number ({@code 0x7f000001}).
     */
    private static boolean isNumeric(String host) {
        String[] labels = host.split("\\.", -1);
        if (labels[labels.length - 1].matches("[0-9]+")) {
            return true;
        }
        for (String label : labels) {
            if (!NUMERIC_LABEL.matcher(label).matches()) {
                return false;
            }
        }
        return true;
    }

    /** Whether a connection to this address leaves the server's own networks. */
    static boolean isPublic(InetAddress address) {
        if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress()
                || address.isSiteLocalAddress() || address.isMulticastAddress()) {
            return false;
        }
        byte[] bytes = address.getAddress();
        if (address instanceof Inet4Address) {
            return isPublicV4(bytes, 0);
        }
        return isPublicV6(bytes);
    }

    private static boolean isPublicV6(byte[] b) {
        int first = b[0] & 0xff;
        int second = b[1] & 0xff;
        if ((first & 0xfe) == 0xfc) {
            return false; // fc00::/7, unique local
        }
        if (first == 0xfe && (second & 0xc0) == 0x80) {
            return false; // fe80::/10, link-local
        }
        if (first == 0xfe && (second & 0xc0) == 0xc0) {
            return false; // fec0::/10, site-local
        }
        if (first == 0xff) {
            return false; // ff00::/8, multicast
        }
        if (startsWith(b, 0x00, 0x64, 0xff, 0x9b) && allZero(b, 4, 12)) {
            return false; // 64:ff9b::/96, NAT64: the IPv4 address in it is reached through a translator
        }
        if (allZero(b, 0, 10) && (b[10] & 0xff) == 0xff && (b[11] & 0xff) == 0xff) {
            return isPublicV4(b, 12); // ::ffff:a.b.c.d, mapped
        }
        if (allZero(b, 0, 12)) {
            return isPublicV4(b, 12); // ::a.b.c.d, compatible (and :: and ::1)
        }
        if (first == 0x20 && second == 0x02) {
            return isPublicV4(b, 2); // 2002::/16, 6to4
        }
        return true;
    }

    /** The IPv4 address at {@code offset} of {@code b} is public: checked by hand, so that it also holds inside IPv6. */
    private static boolean isPublicV4(byte[] b, int offset) {
        int a0 = b[offset] & 0xff;
        int a1 = b[offset + 1] & 0xff;
        int a2 = b[offset + 2] & 0xff;
        return !(a0 == 0                                   // 0.0.0.0/8
                || a0 == 10                                // 10.0.0.0/8
                || a0 == 127                               // 127.0.0.0/8
                || (a0 == 100 && (a1 & 0xc0) == 64)        // 100.64.0.0/10
                || (a0 == 169 && a1 == 254)                // 169.254.0.0/16
                || (a0 == 172 && (a1 & 0xf0) == 16)        // 172.16.0.0/12
                || (a0 == 192 && a1 == 0 && a2 == 0)       // 192.0.0.0/24
                || (a0 == 192 && a1 == 168)                // 192.168.0.0/16
                || (a0 == 198 && (a1 & 0xfe) == 18)        // 198.18.0.0/15
                || a0 >= 224);                             // 224.0.0.0/4 multicast, 240.0.0.0/4 and broadcast
    }

    private static boolean startsWith(byte[] b, int... prefix) {
        for (int i = 0; i < prefix.length; i++) {
            if ((b[i] & 0xff) != prefix[i]) {
                return false;
            }
        }
        return true;
    }

    private static boolean allZero(byte[] b, int from, int to) {
        for (int i = from; i < to; i++) {
            if (b[i] != 0) {
                return false;
            }
        }
        return true;
    }

    /**
     * Reads one entry of {@code demo.link.allowed-origins}. A wrong entry stops the start: a list that is silently
     * shorter would refuse links nobody knows why, and one that is silently wider would be worse.
     */
    private static AllowedOrigin parseOrigin(String entry) {
        Matcher matcher = ORIGIN.matcher(entry.toLowerCase(Locale.ROOT));
        if (!matcher.matches()) {
            throw new IllegalStateException("demo.link.allowed-origins: not scheme://host[:port]: " + entry);
        }
        String scheme = matcher.group(1);
        String host = matcher.group(2);
        boolean wildcard = host.startsWith("*.");
        String name = wildcard ? host.substring(2) : host;
        if (!HOST_NAME.matcher(name).matches() || isNumeric(name) || (wildcard && !name.contains("."))) {
            throw new IllegalStateException("demo.link.allowed-origins: the host has to be a host name, or *. and a "
                    + "domain with at least two labels: " + entry);
        }
        int port = matcher.group(3) == null ? (scheme.equals("https") ? 443 : 80) : Integer.parseInt(matcher.group(3));
        if (port < 1 || port > 65535) {
            throw new IllegalStateException("demo.link.allowed-origins: the port is out of range: " + entry);
        }
        return new AllowedOrigin(scheme, name, wildcard, port);
    }
}
