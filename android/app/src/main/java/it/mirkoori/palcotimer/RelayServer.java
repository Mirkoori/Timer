package it.mirkoori.palcotimer;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/**
 * Server dell'app: serve le pagine e fa da "ponte" tra il controller (la pagina dentro l'app, collegata come "host")
 * e gli altri dispositivi. Non tiene lo stato del timer: lo ha il controller.
 * Stesso comportamento di server.js in modalità ponte (provato dagli stessi test). Solo Java standard, nessuna libreria.
 *
 * Protocollo WebSocket su /ws?room=CODICE&role=viewer|moderator|controller|host:
 *  - host (solo da questo dispositivo): invia {"type":"state",...}, il ponte lo ricorda e lo inoltra a tutti gli altri;
 *  - gli altri: ricevono l'ultimo stato appena si collegano; ciò che inviano arriva all'host come "ruolo|messaggio".
 */
public final class RelayServer {

    /** Dove si trovano le pagine (nell'app: gli asset). Deve lanciare FileNotFoundException se il file non c'è. */
    public interface Assets { InputStream open(String path) throws IOException; }

    private static final Pattern ROOM_RE = Pattern.compile("^[A-Z0-9_-]{2,24}$");
    private static final Set<String> ROLES = new java.util.HashSet<>(java.util.Arrays.asList("controller", "moderator", "viewer"));
    private static final int MAX_PAYLOAD = 256 * 1024;
    private static final int MAX_MSGS_PER_SEC = 60;
    private static final int MAX_HEADER_BYTES = 16 * 1024;
    private static final String WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

    private static final Map<String, String> MIME = new HashMap<>();
    static {
        MIME.put("html", "text/html; charset=utf-8");
        MIME.put("js", "text/javascript; charset=utf-8");
        MIME.put("css", "text/css; charset=utf-8");
        MIME.put("json", "application/json; charset=utf-8");
        MIME.put("svg", "image/svg+xml");
        MIME.put("woff2", "font/woff2");
        MIME.put("png", "image/png");
        MIME.put("ico", "image/x-icon");
        MIME.put("webmanifest", "application/manifest+json");
    }

    private final Assets assets;
    private final int preferredPort;
    private final ExecutorService pool = Executors.newCachedThreadPool(r -> { Thread t = new Thread(r, "palco-conn"); t.setDaemon(true); return t; });
    private final ScheduledExecutorService beat = Executors.newSingleThreadScheduledExecutor(r -> { Thread t = new Thread(r, "palco-beat"); t.setDaemon(true); return t; });
    private final Map<String, Room> rooms = new ConcurrentHashMap<>();
    private volatile ServerSocket serverSocket;
    private volatile boolean running;

    public RelayServer(Assets assets, int preferredPort) {
        this.assets = assets;
        this.preferredPort = preferredPort;
    }

    /** Avvia il server. Prova la porta preferita e le 9 successive (così l'indirizzo resta stabile), poi una libera. */
    public synchronized int start() throws IOException {
        if (running) return port();
        ServerSocket ss = null;
        for (int p = preferredPort; p < preferredPort + 10 && ss == null; p++) {
            try { ss = bind(p); } catch (IOException busy) { /* porta occupata: si prova la successiva */ }
        }
        if (ss == null) ss = bind(0);
        serverSocket = ss;
        running = true;
        final ServerSocket accepting = ss;
        Thread acceptor = new Thread(() -> {
            while (running) {
                try {
                    Socket s = accepting.accept();
                    pool.execute(() -> handle(s));
                } catch (IOException e) {
                    if (!running) return;
                }
            }
        }, "palco-accept");
        acceptor.setDaemon(true);
        acceptor.start();
        beat.scheduleAtFixedRate(this::heartbeat, 5, 5, TimeUnit.SECONDS);
        return port();
    }

    private static ServerSocket bind(int port) throws IOException {
        ServerSocket ss = new ServerSocket();
        ss.setReuseAddress(true);
        try { ss.bind(new InetSocketAddress(port)); } catch (IOException e) { ss.close(); throw e; }
        return ss;
    }

    public int port() { ServerSocket s = serverSocket; return s == null ? -1 : s.getLocalPort(); }
    public boolean isRunning() { return running; }

    public synchronized void stop() {
        running = false;
        try { if (serverSocket != null) serverSocket.close(); } catch (IOException ignored) { }
        for (Room r : rooms.values()) {
            if (r.host != null) r.host.closeQuietly();
            for (Client c : r.clients) c.closeQuietly();
        }
        rooms.clear();
        beat.shutdownNow();
        pool.shutdownNow();
    }

    /** Indirizzi IPv4 di questo dispositivo sulla rete (Wi-Fi o hotspot), quelli Wi-Fi per primi. */
    public static List<String> lanAddresses() {
        List<String> wifi = new ArrayList<>();
        List<String> other = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> nis = NetworkInterface.getNetworkInterfaces();
            while (nis != null && nis.hasMoreElements()) {
                NetworkInterface ni = nis.nextElement();
                if (!ni.isUp() || ni.isLoopback() || ni.isVirtual()) continue;
                String name = ni.getName().toLowerCase(Locale.ROOT);
                if (name.startsWith("rmnet") || name.startsWith("ccmni") || name.startsWith("tun") || name.startsWith("dummy")) continue; // dati mobili e VPN
                for (Enumeration<InetAddress> as = ni.getInetAddresses(); as.hasMoreElements(); ) {
                    InetAddress a = as.nextElement();
                    if (a instanceof java.net.Inet4Address && !a.isLoopbackAddress() && !a.isLinkLocalAddress()) {
                        (name.startsWith("wlan") || name.startsWith("ap") || name.startsWith("eth") || name.startsWith("en") ? wifi : other).add(a.getHostAddress());
                    }
                }
            }
        } catch (Exception ignored) { }
        wifi.addAll(other);
        return wifi;
    }

    // ------------------------------------------------------------------ connessioni

    private void handle(Socket socket) {
        try {
            socket.setTcpNoDelay(true);
            socket.setSoTimeout(15000); // per leggere la richiesta; poi si toglie per i WebSocket
            BufferedInputStream in = new BufferedInputStream(socket.getInputStream(), 8192);
            OutputStream out = socket.getOutputStream();
            String requestLine = readLine(in);
            if (requestLine == null || requestLine.isEmpty()) { socket.close(); return; }
            Map<String, String> headers = new HashMap<>();
            int total = requestLine.length();
            for (String line; (line = readLine(in)) != null && !line.isEmpty(); ) {
                total += line.length();
                if (total > MAX_HEADER_BYTES) { writeSimple(out, 431, "Troppo grande", false); socket.close(); return; }
                int c = line.indexOf(':');
                if (c > 0) headers.put(line.substring(0, c).trim().toLowerCase(Locale.ROOT), line.substring(c + 1).trim());
            }
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) { socket.close(); return; }
            String method = parts[0];
            String target = parts[1];
            String pathPart = target;
            String query = "";
            int q = target.indexOf('?');
            if (q >= 0) { pathPart = target.substring(0, q); query = target.substring(q + 1); }

            boolean upgrade = "websocket".equalsIgnoreCase(headers.getOrDefault("upgrade", ""));
            if (upgrade && pathPart.equals("/ws")) { webSocket(socket, in, out, headers, query); return; }

            serveHttp(out, method, pathPart);
            socket.close();
        } catch (IOException ignored) {
            try { socket.close(); } catch (IOException ignored2) { }
        }
    }

    private void serveHttp(OutputStream out, String method, String path) throws IOException {
        boolean head = method.equals("HEAD");
        if (!method.equals("GET") && !head) { writeSimple(out, 405, "Metodo non consentito", false); return; }
        if (path.equals("/api/ping")) {
            writeBytes(out, 200, MIME.get("json"), "{\"app\":\"palco-timer\",\"ok\":true,\"mode\":\"relay\"}".getBytes(StandardCharsets.UTF_8), "no-store", head);
            return;
        }
        if (path.equals("/api/info")) {
            StringBuilder sb = new StringBuilder("{\"app\":\"palco-timer\",\"mode\":\"relay\",\"ips\":[");
            List<String> ips = lanAddresses();
            for (int i = 0; i < ips.size(); i++) { if (i > 0) sb.append(','); sb.append('"').append(ips.get(i)).append('"'); }
            sb.append("],\"port\":").append(port()).append('}');
            writeBytes(out, 200, MIME.get("json"), sb.toString().getBytes(StandardCharsets.UTF_8), "no-store", head);
            return;
        }
        String rel;
        try { rel = URLDecoder.decode(path.replace("+", "%2B"), "UTF-8"); } catch (Exception e) { writeSimple(out, 400, "Richiesta non valida", head); return; }
        if (rel.endsWith("/")) rel += "index.html";
        if (!rel.startsWith("/") || rel.contains("..") || rel.contains("\\") || rel.indexOf('\0') >= 0) { writeSimple(out, 403, "Vietato", head); return; }
        String asset = rel.substring(1);
        byte[] body;
        try (InputStream is = assets.open(asset)) {
            ByteArrayOutputStream bo = new ByteArrayOutputStream(Math.max(1024, is.available()));
            byte[] buf = new byte[16 * 1024];
            for (int n; (n = is.read(buf)) > 0; ) bo.write(buf, 0, n);
            body = bo.toByteArray();
        } catch (FileNotFoundException e) { writeSimple(out, 404, "Non trovato", head); return; }
        catch (IOException e) { writeSimple(out, 404, "Non trovato", head); return; }
        int dot = asset.lastIndexOf('.');
        String ext = dot >= 0 ? asset.substring(dot + 1).toLowerCase(Locale.ROOT) : "";
        writeBytes(out, 200, MIME.getOrDefault(ext, "application/octet-stream"), body, ext.equals("woff2") ? "public, max-age=86400" : "no-cache", head);
    }

    private static void writeSimple(OutputStream out, int code, String text, boolean head) throws IOException {
        writeBytes(out, code, "text/plain; charset=utf-8", text.getBytes(StandardCharsets.UTF_8), "no-store", head);
    }

    private static void writeBytes(OutputStream out, int code, String type, byte[] body, String cache, boolean head) throws IOException {
        String status = code == 200 ? "OK" : code == 400 ? "Bad Request" : code == 403 ? "Forbidden" : code == 404 ? "Not Found" : code == 405 ? "Method Not Allowed" : "Error";
        String h = "HTTP/1.1 " + code + " " + status + "\r\n"
                + "Content-Type: " + type + "\r\n"
                + "Content-Length: " + body.length + "\r\n"
                + "Cache-Control: " + cache + "\r\n"
                + "X-Content-Type-Options: nosniff\r\n"
                + "Referrer-Policy: no-referrer\r\n"
                + "Connection: close\r\n\r\n";
        out.write(h.getBytes(StandardCharsets.ISO_8859_1));
        if (!head) out.write(body);
        out.flush();
    }

    private static String readLine(InputStream in) throws IOException {
        StringBuilder sb = new StringBuilder();
        for (int c; (c = in.read()) != -1; ) {
            if (c == '\n') return sb.toString();
            if (c != '\r') sb.append((char) c);
            if (sb.length() > MAX_HEADER_BYTES) return sb.toString();
        }
        return sb.length() == 0 ? null : sb.toString();
    }

    // ------------------------------------------------------------------ WebSocket

    private void webSocket(Socket socket, InputStream in, OutputStream out, Map<String, String> headers, String query) throws IOException {
        Map<String, String> params = new HashMap<>();
        for (String kv : query.split("&")) {
            int e = kv.indexOf('=');
            if (e > 0) {
                try { params.put(URLDecoder.decode(kv.substring(0, e), "UTF-8"), URLDecoder.decode(kv.substring(e + 1), "UTF-8")); } catch (Exception ignored) { }
            }
        }
        String roomId = params.getOrDefault("room", "").toUpperCase(Locale.ROOT);
        String role = params.getOrDefault("role", "viewer");
        boolean loopback = socket.getInetAddress().isLoopbackAddress();
        boolean roleOk = ROLES.contains(role) || (role.equals("host") && loopback); // "host" solo da questo dispositivo
        boolean sameOrigin = true;
        String origin = headers.get("origin");
        if (origin != null) {
            try { sameOrigin = new URI(origin).getAuthority().equalsIgnoreCase(headers.getOrDefault("host", "")); } catch (Exception e) { sameOrigin = false; }
        }
        String key = headers.get("sec-websocket-key");
        if (!sameOrigin || !ROOM_RE.matcher(roomId).matches() || !roleOk || key == null) {
            out.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n".getBytes(StandardCharsets.ISO_8859_1));
            out.flush();
            socket.close();
            return;
        }
        try {
            String accept = Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-1").digest((key + WS_GUID).getBytes(StandardCharsets.ISO_8859_1)));
            out.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n").getBytes(StandardCharsets.ISO_8859_1));
            out.flush();
        } catch (java.security.NoSuchAlgorithmException e) { socket.close(); return; }

        socket.setSoTimeout(0);
        socket.setKeepAlive(true);
        Room room = rooms.computeIfAbsent(roomId, k -> new Room());
        Client me = new Client(socket, out, role);

        if (role.equals("host")) {
            Client old = room.host;
            room.host = me;
            if (old != null && old != me) old.close(4000, "sostituito");
        } else {
            room.clients.add(me);
            String last = room.last;
            if (last != null) me.sendText(last);
        }

        try {
            frameLoop(in, me, room);
        } catch (IOException ignored) {
            // connessione chiusa o interrotta
        } finally {
            room.clients.remove(me);
            if (room.host == me) room.host = null;
            me.closeQuietly();
        }
    }

    private void frameLoop(InputStream in, Client me, Room room) throws IOException {
        ByteArrayOutputStream fragments = null;
        boolean fragText = false;
        while (running) {
            int b0 = in.read();
            if (b0 < 0) return;
            int b1 = in.read();
            if (b1 < 0) return;
            boolean fin = (b0 & 0x80) != 0;
            int op = b0 & 0x0f;
            boolean masked = (b1 & 0x80) != 0;
            long len = b1 & 0x7f;
            if (len == 126) len = ((long) readByte(in) << 8) | readByte(in);
            else if (len == 127) { len = 0; for (int i = 0; i < 8; i++) len = (len << 8) | readByte(in); }
            if (len > MAX_PAYLOAD) { me.close(1009, "troppo grande"); return; }
            if (!masked) { me.close(1002, "protocollo"); return; } // i browser mascherano sempre
            byte[] mask = new byte[4];
            readFully(in, mask, 4);
            byte[] payload = new byte[(int) len];
            readFully(in, payload, (int) len);
            for (int i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];

            if (op == 0x8) { me.close(1000, ""); return; }
            if (op == 0x9) { me.send(0xA, payload); continue; }
            if (op == 0xA) continue;

            String text = null;
            if (op == 0x1 || op == 0x2) {
                if (fin) { if (op == 0x1) text = new String(payload, StandardCharsets.UTF_8); }
                else { fragments = new ByteArrayOutputStream(); fragments.write(payload); fragText = op == 0x1; continue; }
            } else if (op == 0x0 && fragments != null) {
                fragments.write(payload);
                if (fragments.size() > MAX_PAYLOAD) { me.close(1009, "troppo grande"); return; }
                if (!fin) continue;
                if (fragText) text = new String(fragments.toByteArray(), StandardCharsets.UTF_8);
                fragments = null;
            }
            if (text != null) onText(me, room, text);
        }
    }

    private void onText(Client me, Room room, String text) {
        if (!me.allow(me.role.equals("host") ? MAX_MSGS_PER_SEC * 4 : MAX_MSGS_PER_SEC)) {
            if (!me.role.equals("host")) me.close(1008, "troppi messaggi");
            return;
        }
        if (me.role.equals("host")) {
            if (!text.startsWith("{\"type\":\"state\"")) return;
            room.last = text;
            for (Client c : room.clients) c.sendText(text);
        } else {
            Client host = room.host;
            // "ruolo|messaggio": il ruolo lo mette il ponte; il testo del client resta intatto dopo la prima barra
            if (host != null) host.sendText(me.role + "|" + text);
        }
    }

    private void heartbeat() {
        String msg = "{\"type\":\"time\",\"serverNow\":" + System.currentTimeMillis() + "}";
        for (Room r : rooms.values()) for (Client c : r.clients) c.sendText(msg);
    }

    private static int readByte(InputStream in) throws IOException {
        int b = in.read();
        if (b < 0) throw new IOException("fine del flusso");
        return b;
    }

    private static void readFully(InputStream in, byte[] buf, int len) throws IOException {
        int off = 0;
        while (off < len) {
            int n = in.read(buf, off, len - off);
            if (n < 0) throw new IOException("fine del flusso");
            off += n;
        }
    }

    // ------------------------------------------------------------------ strutture

    private static final class Room {
        volatile Client host;
        volatile String last;
        final Set<Client> clients = Collections.newSetFromMap(new ConcurrentHashMap<>());
    }

    private static final class Client {
        final Socket socket;
        final OutputStream out;
        final String role;
        private long windowStart = System.currentTimeMillis();
        private int count;
        private boolean closed;

        Client(Socket socket, OutputStream out, String role) { this.socket = socket; this.out = out; this.role = role; }

        boolean allow(int perSecond) {
            long now = System.currentTimeMillis();
            if (now - windowStart >= 1000) { windowStart = now; count = 0; }
            return ++count <= perSecond;
        }

        void sendText(String s) { send(0x1, s.getBytes(StandardCharsets.UTF_8)); }

        synchronized void send(int opcode, byte[] payload) {
            if (closed) return;
            try {
                ByteArrayOutputStream f = new ByteArrayOutputStream(payload.length + 10);
                f.write(0x80 | opcode);
                if (payload.length < 126) f.write(payload.length);
                else if (payload.length < 65536) { f.write(126); f.write(payload.length >> 8); f.write(payload.length & 0xff); }
                else { f.write(127); for (int i = 7; i >= 0; i--) f.write((int) (((long) payload.length >> (8 * i)) & 0xff)); }
                f.write(payload);
                out.write(f.toByteArray());
                out.flush();
            } catch (IOException e) { closeQuietly(); }
        }

        void close(int code, String reason) {
            byte[] r = reason.getBytes(StandardCharsets.UTF_8);
            byte[] p = new byte[2 + r.length];
            p[0] = (byte) (code >> 8); p[1] = (byte) code;
            System.arraycopy(r, 0, p, 2, r.length);
            send(0x8, p);
            closeQuietly();
        }

        synchronized void closeQuietly() {
            closed = true;
            try { socket.close(); } catch (IOException ignored) { }
        }
    }
}
