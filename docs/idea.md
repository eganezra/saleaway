# Saleaway (saleaway.co.za) — Initial Idea

A website that automatically finds sales at South African online stores and shows them all in one place.

Once a day, a scheduled job takes the list of stores from the database and checks each one for a sale page at common addresses like /sale, /outlet or /specials. Any page it finds is checked to make sure it's a real, active sale with discounted products. The real ones are captured, tidied into a clean, consistent format, and saved back to the database.

The website reads from that database, so visitors always see the latest sales from every store without visiting each site themselves. The next day the cycle repeats, adding new sales and removing ones that have ended.

Diagram: [architecture-diagram.jpg](architecture-diagram.jpg)

Flow: Cron job (24h) -> Probe sale paths (/sale, /outlet, /warehouse...; domains from Retailers table) -> Validate pages (real sale content) -> Snapshot and beautify (web PDF, clean layout; stored in Sale pages table) -> Saleaway.co.za shows current sales.
