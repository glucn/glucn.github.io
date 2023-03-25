---
title: "DNSSEC Explained"
description: "What is and is not DNSSEC?"
date: 2022-01-14T00:00:00
draft: false
showToc: true
tocOpen: true
cover:
    image: https://miro.medium.com/v2/resize:fit:1100/0*73ahdznC-sYVT3c1
    caption: Photo by [Brett Jordan](https://unsplash.com/@brett_jordan?utm_source=medium&utm_medium=referral) on [Unsplash](https://unsplash.com/?utm_source=medium&utm_medium=referral)
---

*Originally posted on [Medium](https://medium.com/gitconnected/what-is-dnssec-90b89671c1dd).*

DNSSEC stands for Domain Name System Security Extensions. By adding some additional records in the response, DNSSEC can guarantee that a DNS query is answered by an authenticated origin and therefore protect the data integrity of DNS. Before we step into the details of DNSSEC, let’s look at why we need a “security extension” of DNS.

## Why do we need DNSSEC?

To explain why we need DNSSEC, we can start with how DNS works.

When we query the address of a domain name, we will usually be talking to a recursive DNS resolver. The recursive resolver will query with multiple name servers recursively, following the hierarchy of the delegation chain from top to bottom. The following GIF illustrates that process.

![How DNS works (GIF](https://miro.medium.com/v2/resize:fit:1100/1*Pk4lgMDkQropmFpSKkoBVg.gif)

As one of the oldest protocols of the network, DNS has many problems. For example, DNS query and response are not encrypted, and the response does not carry enough information to show that it is from who should answer the query.

With these problems, a bad actor can tap into the conversation between resolver and nameservers and send a forged answer to the resolver. The forged answer will lead the client to a malicious destination. This is called the “Man-in-the-middle” (MITM) attack.

![DNS process compromised by a man-in-the-middle attack](https://miro.medium.com/v2/resize:fit:1100/1*KQo1M9s8htAuRk2OszIJ5Q.gif)

DNSSEC is a protocol that can defend against such attacks.


## How DNSSEC works?

DNSSEC introduces the following few new types of DNS records:

- RRSIG
- DNSKEY
- DS
- (I’m skipping NSEC and all the types for the negative response, they are worth a standalone blog post)

RRSIG record essentially contains the cryptographic signature of another DNS record. And DNSKEY record contains the information of the public key. (If you are not familiar with cryptographic signing or digital signing, please read more at [wiki](https://en.wikipedia.org/wiki/Digital_signature))

With the RRSIG record and DNSKEY record, a resolver can validate that the DNS record, which RRSIG covers, is not altered by another one. But here comes another question, how can a resolver knows a DNSKEY record is trustworthy?

Enter “Chain-of-trust” or its official name in the RFC, “Authentication Chain.”

Earlier, I mentioned the DS record. The DS (delegation signer) record contains the hash digest of the public key(DNSKEY). While a DNSKEY record is in a zone, its corresponding DS record should be in the parent zone. With the DS record, a resolver can validate if it can trust a DNSKEY record. I think the following image can illustrate the idea of “Chain-of-trust.”

![Chain-of-trust](https://miro.medium.com/v2/resize:fit:1100/format:webp/1*eABQcocPnirfWuF3quDspg.png)

So for DNSSEC to be fully functional, a zone needs to publish the DNSKEY records (let’s talk about KSK and ZSK in another blog post) and sign all the records in the zone with RRSIG records. Also, the parent zone needs to have the DS record.

Put everything together, here is a GIF showing how DNS works with DNSSEC validation enabled on the resolver and DNSSEC signing enabled in all zones on the delegation chain:

![How DNS works with DNSSEC signing and validation enabled](https://miro.medium.com/v2/resize:fit:1100/1*QwOQC5VBknbrO8bUpH_ceQ.gif)

## What is DNSSEC not?
DNSSEC can prevent the risk of MITM attacks, but it is not a cure-all elixir. Here are two examples that DNSSEC cannot solve.

### 1. DNSSEC does not protect the privacy of DNS
Although DNSSEC involves cryptography keys, it does not encrypt any DNS query or response information. With DNSSEC in place, the content of DNS traffic is still visible to some attackers who want to steal information from it.

There have been some other protocols, like DNS-over-TLS (DoT) and DNS-over-HTTPS (DoH), which can make DNS traffic more secured because the content will be encrypted. But DNSSEC cannot protect you on that end.

### 2. The “last-mile” security problem of DNSSEC
In the GIF image above, we can see that after the resolver has validated the response with DNSSEC, it will send the response to the client. But what if there is an attacker between the client and the resolver?

![“Last-mile” security problem](https://miro.medium.com/v2/resize:fit:1100/1*Sb5p7V6mJHYEThKbgN7r0A.gif)

If the client and resolver are two applications on the same machine or two machines inside the same firewall, this “last-mile” problem will become a non-issue. However, for most of the clients on the Internet, DNSSEC itself does not protect against this problem. There’re some proposals, like using TSIG record to authenticate between the client and the resolver, but this is generally still an open question.


## Shall I start using DNSSEC, like, now?

There is no easy answer to this question.

With all the protection DNSSEC brings, it also comes with some operational burden. Although most of the big DNS providers, like AWS, Google, Cloudflare, will take care of the majority of the operational burdens, there are still a lot of things that you need to be aware of. I want to use another blog post to discuss the details of the operational burdens. So, let me drop some quick answers here.

If you are doing some businesses that require compliance with some government standard, like FedRamp, then the answer is definitely YES.

If you are starting a new website, the answer is probably YES.

If your website already has thousands or even millions of users, NO. You need to read much more than just this blog post.

## Conclusion

DNSSEC is a protocol that can bring DNS security to a much higher level. With DNSSEC signing enabled, a security-aware resolver can validate that the response is from an authenticated origin.

However, DNSSEC cannot protect the privacy of DNS traffic. And there is still the “last-mile” security problem, which needs further work.

Regarding if we should start using DNSSEC, I didn’t come up with an answer. I plan to write a few more posts about DNSSEC, hoping they can answer some more questions that you may have. Thank you for reading!

#### Resources
- [RFC4033 DNS Security Introduction and Requirements](https://datatracker.ietf.org/doc/html/rfc4033)
- [RFC4034 Resource Records for the DNS Security Extensions](https://datatracker.ietf.org/doc/html/rfc4034)
- [RFC4035 Protocol Modifications for the DNS Security Extensions](https://datatracker.ietf.org/doc/html/rfc4035)
