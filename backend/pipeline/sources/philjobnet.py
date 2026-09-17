"""PhilJobNet adapter — DELIBERATELY GATED, NOT IMPLEMENTED.

PhilJobNet (DOLE Bureau of Local Employment) is the most on-topic source for a
Philippine study, and it is the natural analogue of mycareersfuture.sg used by
Bhola et al. (2020). It is not implemented here, for reasons you should record
in your methodology rather than work around:

1. philjobnet.gov.ph serves no robots.txt (checked Aug 2026), so there is no
   machine-readable crawl policy to comply with. Absence of a policy is not
   permission.
2. It publishes no public API and no bulk export.
3. It is a government service. Automated collection should be *requested*, not
   assumed. DOLE-BLE can be approached directly for a research data extract,
   and a granted request is a far stronger thing to write in Chapter 3 than a
   scrape.

Recommended path: send a written data request to DOLE-BLE citing your study,
and use reviewed employer postings or JSearch discovery in the interim.
If a request is granted, implement fetch() below against whatever export they
provide and set access_basis to "data request granted by DOLE-BLE, <date>".
"""

from __future__ import annotations

from typing import Any, Iterator

from .base import JobSource, RawPosting, register


@register
class PhilJobNetSource(JobSource):
    name = "philjobnet"
    access_basis = "REQUIRES WRITTEN DATA REQUEST TO DOLE-BLE"
    requires_tos_acknowledgement = True
    tos_url = "https://philjobnet.gov.ph/"

    def fetch(self, **kwargs: Any) -> Iterator[RawPosting]:
        raise NotImplementedError(
            "PhilJobNet collection is intentionally not implemented. See the module "
            "docstring: request a research extract from DOLE-BLE, then implement "
            "this adapter against the format they supply. Use reviewed employer data "
            "meanwhile."
        )
