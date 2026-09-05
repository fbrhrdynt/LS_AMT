import { useMemo } from "react";
import { SelectInput } from "@/components/Bits";


function selectableJob(job) {
  return !["Completed", "Cancelled"].includes(job?.status);
}


export default function JobLocationFields({
  jobs = [],
  value = {},
  onChange,
}) {
  const availableJobs = useMemo(
    () => jobs.filter(selectableJob),
    [jobs]
  );

  const clients = useMemo(() => {
    const map = new Map();

    availableJobs.forEach((job) => {
      if (job.client_id) {
        map.set(job.client_id, job.client_name || job.client_id);
      }
    });

    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [availableJobs]);

  const sites = useMemo(() => {
    const rows = availableJobs.filter(
      (job) =>
        !value.client_id ||
        job.client_id === value.client_id
    );

    return [
      ...new Set(
        rows
          .map((job) => (job.site_location || "").trim())
          .filter(Boolean)
      ),
    ].sort((a, b) => a.localeCompare(b));
  }, [availableJobs, value.client_id]);

  const filteredJobs = useMemo(
    () =>
      availableJobs.filter((job) => {
        const clientMatch =
          !value.client_id ||
          job.client_id === value.client_id;

        const siteMatch =
          !value.site_location ||
          (job.site_location || "") === value.site_location;

        return clientMatch && siteMatch;
      }),
    [
      availableJobs,
      value.client_id,
      value.site_location,
    ]
  );

  const chooseJob = (jobId) => {
    const job = availableJobs.find(
      (item) => item.id === jobId
    );

    if (!job) {
      onChange?.({
        ...value,
        job_id: "",
      });
      return;
    }

    onChange?.({
      job_id: job.id,
      client_id: job.client_id || "",
      site_location: job.site_location || "",
    });
  };

  const chooseClient = (clientId) => {
    onChange?.({
      job_id: "",
      client_id: clientId,
      site_location: "",
    });
  };

  const chooseSite = (site) => {
    onChange?.({
      ...value,
      job_id: "",
      site_location: site,
    });
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <SelectInput
        label="Job"
        className="sm:col-span-2"
        value={value.job_id || ""}
        onChange={(e) => chooseJob(e.target.value)}
        data-testid="location-job"
      >
        <option value="">Select job…</option>
        {filteredJobs.map((job) => (
          <option key={job.id} value={job.id}>
            {job.job_number} · {job.field_name || job.job_name || "Unnamed Field"}
          </option>
        ))}
      </SelectInput>

      <SelectInput
        label="Client"
        value={value.client_id || ""}
        onChange={(e) => chooseClient(e.target.value)}
        data-testid="location-client"
      >
        <option value="">All clients…</option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </SelectInput>

      <SelectInput
        label="Site"
        value={value.site_location || ""}
        onChange={(e) => chooseSite(e.target.value)}
        data-testid="location-site"
      >
        <option value="">All sites…</option>
        {sites.map((site) => (
          <option key={site} value={site}>
            {site}
          </option>
        ))}
      </SelectInput>

      <div className="sm:col-span-2 text-xs leading-5 text-slate-400">
        Selecting a Job automatically sets its Client and Site.
        Client and Site can also be used to filter the Job list.
      </div>
    </div>
  );
}
