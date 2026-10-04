use crate::proto;
use crate::types::TrajectorySample;

pub fn sample_to_proto(sample: &TrajectorySample) -> proto::TrajectorySample {
    proto::TrajectorySample {
        session_id: sample.session_id.clone(),
        timestamp_ms: sample.timestamp_ms,
        latitude: sample.latitude,
        longitude: sample.longitude,
        speed_mps: sample.speed_mps,
        edge_id: sample.edge_id.clone(),
        heading_deg: sample.heading_deg,
        sensor_tuple_json: sample.sensor_tuple.clone(),
        image_event_id: sample.image_event_id.clone(),
        workload_class: sample.workload_class.clone(),
        image_jpeg: {
            let bytes = decode_image(sample);
            if bytes.is_empty() {
                None
            } else {
                Some(bytes)
            }
        },
    }
}

pub fn sample_from_proto(proto_sample: proto::TrajectorySample) -> TrajectorySample {
    let image_jpeg_b64 = proto_sample
        .image_jpeg
        .as_ref()
        .filter(|b| !b.is_empty())
        .map(|b| b64_encode(b));
    TrajectorySample {
        session_id: proto_sample.session_id,
        timestamp_ms: proto_sample.timestamp_ms,
        latitude: proto_sample.latitude,
        longitude: proto_sample.longitude,
        speed_mps: proto_sample.speed_mps,
        edge_id: proto_sample.edge_id,
        heading_deg: proto_sample.heading_deg,
        sensor_tuple: proto_sample.sensor_tuple_json,
        image_event_id: proto_sample.image_event_id,
        workload_class: proto_sample.workload_class,
        image_jpeg_b64,
    }
}

pub fn decode_image(sample: &TrajectorySample) -> Vec<u8> {
    sample
        .image_jpeg_b64
        .as_deref()
        .and_then(b64_decode)
        .unwrap_or_default()
}

pub fn has_image_payload(sample: &TrajectorySample) -> bool {
    !decode_image(sample).is_empty()
        || sample
            .workload_class
            .as_deref()
            .is_some_and(|c| c.eq_ignore_ascii_case("image"))
}

fn b64_decode(raw: &str) -> Option<Vec<u8>> {
    fn val(c: u8) -> Option<u8> {
        match c {
            b'A'..=b'Z' => Some(c - b'A'),
            b'a'..=b'z' => Some(c - b'a' + 26),
            b'0'..=b'9' => Some(c - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    let mut buf = 0u32;
    let mut n = 0;
    for &c in bytes {
        if c == b'=' {
            break;
        }
        let Some(v) = val(c) else {
            continue;
        };
        buf = (buf << 6) | u32::from(v);
        n += 6;
        if n >= 8 {
            n -= 8;
            out.push((buf >> n) as u8);
        }
    }
    Some(out)
}

fn b64_encode(bytes: &[u8]) -> String {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    let mut i = 0;
    while i < bytes.len() {
        let b0 = bytes[i];
        let b1 = bytes.get(i + 1).copied();
        let b2 = bytes.get(i + 2).copied();
        out.push(T[(b0 >> 2) as usize] as char);
        out.push(T[(((b0 & 0x03) << 4) | (b1.unwrap_or(0) >> 4)) as usize] as char);
        if b1.is_some() {
            out.push(T[(((b1.unwrap_or(0) & 0x0f) << 2) | (b2.unwrap_or(0) >> 6)) as usize] as char);
        } else {
            out.push('=');
        }
        if b2.is_some() {
            out.push(T[(b2.unwrap_or(0) & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
        i += 3;
    }
    out
}
