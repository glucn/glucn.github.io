---
title: "Mock DNS Server in Java"
date: 2020-04-25T00:00:00
draft: false
---

![This machine is a server! (London Science Museum, by Binary Koala)](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*p0c-XD--h8iU7p8y3-aJMQ.jpeg)

*Originally posted on [Medium](https://medium.com/swlh/mock-a-dns-server-in-java-a810b9338872).*


I’ve been using the Java library [dnsjava](https://github.com/dnsjava/dnsjava) (org.xbill.DNS) a lot recently to make DNS queries. Since my work will rely on the behavior of that library, I figured I have to understand it better. One way to understand a library will be to read through all the code, but I prefer to write some tests to validate my understanding.

The application code is straightforward as the following. One thing I wanted to understand was how the library would handle retrying when the DNS query fails, for example, timed out.

```
import org.xbill.DNS.Lookup;
import org.xbill.DNS.Name;
import org.xbill.DNS.Record;
import org.xbill.DNS.Resolver;
import org.xbill.DNS.TextParseException;

import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

public class LookupUtil {
    

    public static List<String> forNameType(Resolver resolver, String nameStr, int type) {
        Name name;

        try {
            name = Name.fromString(nameStr);
        } catch (TextParseException e) {
            throw new IllegalArgumentException();
        }
        Lookup lookup = new Lookup(name, type);
        lookup.setResolver(resolver);
        lookup.setCache(null);
        lookup.run();

        if (lookup.getResult() != Lookup.SUCCESSFUL) {
            throw new RuntimeException(lookup.getErrorString());
        }
        return Arrays.stream(lookup.getAnswers())
                .map(Record::rdataToString)
                .collect(Collectors.toList());
    }
}
```


I tried to write some tests by mocking the `Resolver` interface. However, it turned out the retrying logic was actually in the `Resolver` interface and its implementations, more specifically, `SimpleResolver` and `ExtendedResolver`. I could look into the detail and try to mock some underlying class or function calls, but I felt less confident about that. Instead, I decided to build a mock DNS server in the test.

The code for the DNS server is like the following. To deliberately make the DNS query fail, I put a `Thread.sleep(5000)` in there.

```
private static class TestDNSServer {
    private Thread thread = null;
    private volatile boolean running = false;
    private static final int UDP_SIZE = 512;
    private final int port;
    private int requestCount = 0;
    
    TestDNSServer(int port) {
        this.port = port;
    }
    
    public void start() {
        running = true;
        thread = new Thread(() -> {
            try {
                serve();
            } catch (IOException ex) {
                stop();
                throw new RuntimeException(ex);
            }
        });
        thread.start();
    }
    
    public void stop() {
        running = false;
        thread.interrupt();
        thread = null;
    }
    
    public int getRequestCount() {
        return requestCount;
    }
    
    private void serve() throws IOException {
        DatagramSocket socket = new DatagramSocket(port);
        while (running) {
            process(socket);
        }
    }
    
    private void process(DatagramSocket socket) throws IOException {
        byte[] in = new byte[UDP_SIZE];
        // Read the request
        DatagramPacket indp = new DatagramPacket(in, UDP_SIZE);
        socket.receive(indp);
        ++requestCount;
        logger.info(String.format("processing... %d", requestCount));
        // Build the response
        Message request = new Message(in);
        Message response = new Message(request.getHeader().getID());
        response.addRecord(request.getQuestion(), Section.QUESTION);
        // Add answers as needed
        response.addRecord(Record.fromString(Name.root, Type.A, DClass.IN, 86400, "1.2.3.4", Name.root), Section.ANSWER);
        // Make it timeout, comment this section if a success response is needed
        try {
            Thread.sleep(5000);
        } catch (InterruptedException ex) {
            logger.error("Interrupted");
            return;
        }
        byte[] resp = response.toWire();
        DatagramPacket outdp = new DatagramPacket(resp, resp.length, indp.getAddress(), indp.getPort());
        socket.send(outdp);
    }
}
```

Firstly, I tested `SimpleResolver` with this mocked server. Note that I set the query timeout to be 1 second here.

```
@Test
public void simpleResolver() throws IOException {
    TestDNSServer server = new TestDNSServer(53);
    server.start();
    SimpleResolver resolver = new SimpleResolver(InetAddress.getLocalHost());
    resolver.setTimeout(Duration.ofSeconds(1));
    Lookup lookup = new Lookup(Name.root, Type.A);
    lookup.setResolver(resolver);
    lookup.setCache(null);
    lookup.run();
    Assertions.assertEquals(1, server.getRequestCount());
    server.stop();
}
```

From this test, I could see that `SimpleResolver` would not retry when the query failed. This test confirmed what I read in the code of `SimpleResolver` and the underlying `NioUdpClient`.

The next one I needed to test is `ExtendedResolver`, which was supposed to have some retry logic in it and should round-robin with multiple `Resolvers`.

```
@Test
public void extendedResolver() throws IOException {
    List<TestDNSServer> servers = new ArrayList<>();
    List<Resolver> resolvers = new ArrayList<>();
    for (int i = 0; i<5; i++) {
        int port = 1000 + i * 100 + 53;
        TestDNSServer s = new TestDNSServer(port);
        s.start();
        servers.add(s);
        SimpleResolver r = new SimpleResolver(InetAddress.getLocalHost());
        r.setPort(port);
        // r.setTimeout(Duration.ofSeconds(1));  // Timeout of each resolver will be overwritten to ExtendedResolver.DEFAULT_TIMEOUT
        resolvers.add(r);
    }
    
    ExtendedResolver resolver = new ExtendedResolver(resolvers);
    resolver.setTimeout(Duration.ofSeconds(1));
    resolver.setRetries(5);
    Lookup lookup = new Lookup(Name.root, Type.A);
    lookup.setResolver(resolver);
    lookup.setCache(null);
    long startTime = System.currentTimeMillis();
    lookup.run();
    logger.error(String.format("time: %d", (System.currentTimeMillis() - startTime)/1000));
    for (TestDNSServer s: servers) {
        Assertions.assertEquals(5, s.getRequestCount()); // This will fail as ExtendedResolver does not work as I expected
        s.stop();
    }
}
```

As I commented in the code, the assertion failed. The test ended in about 10 secs, which was about the time of retrying each resolver for two times.

Why? It turned out `ExtendedResolver` did not override the method [`getTimeout()`](https://github.com/dnsjava/dnsjava/blob/master/src/main/java/org/xbill/DNS/Resolver.java#L127-L134) of the `Resolver` interface so that the query will be timeout after 10 seconds. Having this 10 seconds timeout made sense to me, but it would catch me if I did not carry out these tests.

Please find the full test code as follows.

```
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.xbill.DNS.DClass;
import org.xbill.DNS.ExtendedResolver;
import org.xbill.DNS.Lookup;
import org.xbill.DNS.Message;
import org.xbill.DNS.Name;
import org.xbill.DNS.Record;
import org.xbill.DNS.Resolver;
import org.xbill.DNS.Section;
import org.xbill.DNS.SimpleResolver;
import org.xbill.DNS.Type;

import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;


public class TestResolver {
    private static final Logger logger = LoggerFactory.getLogger(TestResolver.class);

    @Test
    public void simpleResolver() throws IOException {
        TestDNSServer server = new TestDNSServer(53);
        server.start();
        SimpleResolver resolver = new SimpleResolver(InetAddress.getLocalHost());
        resolver.setTimeout(Duration.ofSeconds(1));

        Lookup lookup = new Lookup(Name.root, Type.A);
        lookup.setResolver(resolver);
        lookup.setCache(null);

        lookup.run();

        Assertions.assertEquals(1, server.getRequestCount());

        server.stop();
    }

    @Test
    public void extendedResolver() throws IOException {
        List<TestDNSServer> servers = new ArrayList<>();
        List<Resolver> resolvers = new ArrayList<>();
        for (int i = 0; i<5; i++) {
            int port = 1000 + i * 100 + 53;
            TestDNSServer s = new TestDNSServer(port);
            s.start();
            servers.add(s);
            SimpleResolver r = new SimpleResolver(InetAddress.getLocalHost());
            r.setPort(port);
            // r.setTimeout(Duration.ofSeconds(1));  // Timeout of each resolver will be overwritten to ExtendedResolver.DEFAULT_TIMEOUT
            resolvers.add(r);
        }

        ExtendedResolver resolver = new ExtendedResolver(resolvers);
        resolver.setTimeout(Duration.ofSeconds(1));
        resolver.setRetries(5);

        Lookup lookup = new Lookup(Name.root, Type.A);
        lookup.setResolver(resolver);
        lookup.setCache(null);

        long startTime = System.currentTimeMillis();
        lookup.run();
        logger.error(String.format("time: %d", (System.currentTimeMillis() - startTime)/1000));

        for (TestDNSServer s: servers) {
            Assertions.assertEquals(5, s.getRequestCount()); // This will fail as ExtendedResolver does not work as I expected
            s.stop();
        }
    }

    private static class TestDNSServer {
        private Thread thread = null;
        private volatile boolean running = false;
        private static final int UDP_SIZE = 512;
        private final int port;
        private int requestCount = 0;

        TestDNSServer(int port) {
            this.port = port;
        }

        public void start() {
            running = true;
            thread = new Thread(() -> {
                try {
                    serve();
                } catch (IOException ex) {
                    stop();
                    throw new RuntimeException(ex);
                }
            });
            thread.start();
        }

        public void stop() {
            running = false;
            thread.interrupt();
            thread = null;
        }

        public int getRequestCount() {
            return requestCount;
        }

        private void serve() throws IOException {
            DatagramSocket socket = new DatagramSocket(port);
            while (running) {
                process(socket);
            }
        }

        private void process(DatagramSocket socket) throws IOException {
            byte[] in = new byte[UDP_SIZE];

            // Read the request
            DatagramPacket indp = new DatagramPacket(in, UDP_SIZE);
            socket.receive(indp);
            ++requestCount;
            logger.info(String.format("processing... %d", requestCount));

            // Build the response
            Message request = new Message(in);
            Message response = new Message(request.getHeader().getID());
            response.addRecord(request.getQuestion(), Section.QUESTION);
            // Add answers as needed
            response.addRecord(Record.fromString(Name.root, Type.A, DClass.IN, 86400, "1.2.3.4", Name.root), Section.ANSWER);

            // Make it timeout, comment this section if a success response is needed
            try {
                Thread.sleep(5000);
            } catch (InterruptedException ex) {
                logger.error("Interrupted");
                return;
            }

            byte[] resp = response.toWire();
            DatagramPacket outdp = new DatagramPacket(resp, resp.length, indp.getAddress(), indp.getPort());
            socket.send(outdp);
        }
    }
}
```

## Conclusion
It would always be helpful to validate your assumption and understanding of a 3rd party library by writing some tests. This article shows an example of mocking a DNS server during the tests. I would like to know if there is any better way to do it, please leave your comment. Thank you, and enjoy coding!
