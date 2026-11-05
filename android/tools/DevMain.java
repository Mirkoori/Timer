import it.mirkoori.palcotimer.RelayServer;
import java.io.*;
import java.nio.file.*;

/** Solo per provare il server sul computer: java DevMain <cartella public> <porta> */
public class DevMain {
    public static void main(String[] a) throws Exception {
        Path root = Paths.get(a[0]).toAbsolutePath().normalize();
        RelayServer s = new RelayServer(path -> {
            Path f = root.resolve(path).normalize();
            if (!f.startsWith(root) || !Files.isRegularFile(f)) throw new FileNotFoundException(path);
            return Files.newInputStream(f);
        }, Integer.parseInt(a[1]));
        System.out.println("porta " + s.start());
        Thread.currentThread().join();
    }
}
