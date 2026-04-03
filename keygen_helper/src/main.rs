use minisign::KeyPair;

fn main() {
    // Generate with empty password (no interactive prompt)
    let kp = KeyPair::generate_encrypted_keypair(Some(String::new()))
        .expect("keygen failed");

    let pk_box = kp.pk.to_box().expect("pk box");
    let sk_box = kp.sk.to_box(None).expect("sk box");

    let pk_bytes = pk_box.to_bytes();
    let sk_bytes = sk_box.to_bytes();

    let pk_str = String::from_utf8(pk_bytes).expect("pk utf8");
    let sk_str = String::from_utf8(sk_bytes).expect("sk utf8");

    // pubkey line = second line of the box
    let pub_b64 = pk_str.lines()
        .find(|l| !l.starts_with("untrusted") && !l.is_empty())
        .unwrap_or("");

    println!("PUBLIC_KEY:{}", pub_b64);
    println!("SECRET_KEY_START");
    print!("{}", sk_str);
    println!("SECRET_KEY_END");
}
