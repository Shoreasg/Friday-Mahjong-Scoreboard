const reservationPathPattern = /^\/app\/reservations(?:\/\d+)?(?:[?#][^\r\n]*)?$/;

export function reservationSignInPath(destination: string) {
  return `/sign-in?redirect_url=${encodeURIComponent(destination)}`;
}

export function safeReservationRedirect(search: string) {
  const destination = new URLSearchParams(search).get("redirect_url");
  return destination && reservationPathPattern.test(destination) ? destination : undefined;
}
