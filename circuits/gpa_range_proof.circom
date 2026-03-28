/*
 * GPA Range Proof Circuit (Circom v1 syntax)
 * Self-contained — no external dependencies
 * 
 * Proves: gpa > threshold WITHOUT revealing actual GPA
 * Values are scaled by 10 (e.g., 87 = GPA 8.7, 80 = threshold 8.0)
 *
 * How it works:
 *   1. Compute diff = gpa - threshold  
 *   2. Decompose diff into bits to prove it's positive (range check)
 *   3. Constrain that diff > 0 (i.e., gpa > threshold)
 */

template Num2Bits(n) {
    signal input in;
    signal output out[n];
    
    var lc1 = 0;
    for (var i = 0; i < n; i++) {
        out[i] <-- (in >> i) & 1;
        out[i] * (out[i] - 1) === 0;
        lc1 = lc1 + out[i] * (1 << i);
    }
    lc1 === in;
}

template IsPositive(n) {
    signal input in;
    signal output out;
    
    // in must be > 0 and fit in n bits
    // We check 'in - 1' fits in n bits (which means in >= 1, so in > 0)
    signal diff;
    diff <== in - 1;
    
    component bits = Num2Bits(n);
    bits.in <== diff;
    
    // If we got here without error, diff >= 0, so in >= 1 (in > 0)
    out <== 1;
}

template GpaRangeProof(n) {
    // Private input: actual GPA (scaled by 10)
    signal private input gpa;
    
    // Public input: threshold (scaled by 10)
    signal input threshold;
    
    // Compute difference
    signal diff;
    diff <== gpa - threshold;
    
    // Prove diff > 0 (i.e., gpa > threshold)
    component pos = IsPositive(n);
    pos.in <== diff;
    
    // This circuit will only produce a valid proof if gpa > threshold
    // The prover cannot generate a valid witness otherwise
    pos.out === 1;
}

// 8-bit range: values 0-255, sufficient for GPA*10 (0-100)
component main = GpaRangeProof(8);
