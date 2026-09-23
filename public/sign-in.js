const parameters = new URLSearchParams(window.location.search);
const status = document.querySelector('#sign-in-status');
const link = document.querySelector('#sign-in-link');
const requestedReturnTo = parameters.get('returnTo') ?? '/';

// The server validates returnTo again before storing the one-use login transaction.
const returnTo = requestedReturnTo.startsWith('/') && !requestedReturnTo.startsWith('//')
  && !requestedReturnTo.includes('\\') ? requestedReturnTo : '/';
link.href = `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;

if (parameters.get('error') === 'login_failed') {
  status.textContent = 'Sign-in could not be verified. Start again, or contact your organization administrator.';
} else if (parameters.get('signed_out') === '1') {
  status.textContent = 'You are signed out.';
}
