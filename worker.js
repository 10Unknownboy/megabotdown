export default {
  async fetch(req) {
    const url = new URL(req.url);
    const file = url.searchParams.get("file");

    if (!file) {
      return new Response("Please provide ?file=<mega-link>", { status: 400 });
    }

    // Here later we handle Mega API or headless fetch
    return Response.redirect(file, 302); 
  }
}
