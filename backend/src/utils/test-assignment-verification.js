const jwt = require('jsonwebtoken');

const SSO_SECRET = 'estrowork-sso-shared-secret-2026-3-5-12';
const MAIN_BACKEND_URL = 'http://localhost:4001/api/v1';

async function testAssignment() {
    const email = 'muhammadadil@techcreator.co';
    const containerId = 'test-container-id-' + Date.now();

    console.log('--- Testing AI Project Assignment ---');
    console.log(`Email: ${email}`);
    console.log(`Container ID: ${containerId}`);

    // 1. Generate token
    const token = jwt.sign(
        { email, containerId, source: 'estroworkai' },
        SSO_SECRET,
        { expiresIn: '5m' }
    );

    console.log('Generated Token:', token);

    // 2. Send request
    try {
        const response = await fetch(`${MAIN_BACKEND_URL}/ai-projects/assign`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Service-Token': `Bearer ${token}`
            },
            body: JSON.stringify({ email, containerId })
        });

        const status = response.status;
        const result = await response.json();

        console.log(`Response Status: ${status}`);
        console.log('Response Body:', JSON.stringify(result, null, 2));

        if (status === 201 || (status === 200 && result.success)) {
            console.log('✅ SUCCESS: Assignment works!');
        } else {
            console.error('❌ FAILURE: Assignment failed.');
        }
    } catch (error) {
        console.error('❌ ERROR: Request failed:', error.message);
    }
}

testAssignment();
